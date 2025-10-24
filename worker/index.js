import { scrypt } from "scrypt-js";
import jwt from "@tsndr/cloudflare-worker-jwt";

async function authenticateUser(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header.", status: 401 };
  }
  const token = authHeader.split(" ")[1];
  try {
    const isValid = await jwt.verify(token, env.JWT_SECRET);
    if (!isValid) {
      return { error: "Invalid token.", status: 401 };
    }
    const payload = jwt.decode(token).payload;
    if (!payload || typeof payload.sub === 'undefined') {
       throw new Error("Invalid token payload");
    }
    return { user: payload };
  } catch (err) {
      console.error("Authentication error:", err); 
      return { error: `Invalid token: ${err.message}`, status: 401 };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      try {
        if (pathname === "/api/signup" && request.method === "POST") {
          const body = await request.json();
          const { email, password } = body;
          if (!email || !password) return new Response("Email and password are required.", { status: 400 });

          const salt = crypto.getRandomValues(new Uint8Array(16));
          const passwordBuffer = new TextEncoder().encode(password);
          const hashBuffer = await scrypt(passwordBuffer, salt, 16384, 8, 1, 64);
          const hashHex = Array.from(hashBuffer).map((b) => b.toString(16).padStart(2, "0")).join("");
          const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
          const password_hash = `${saltHex}:${hashHex}`;

          await env.USER_DATA.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").bind(email, password_hash).run();
          return new Response("User created successfully.", { status: 201 });
        }

        if (pathname === "/api/login" && request.method === "POST") {
          const body = await request.json();
          const { email, password } = body;
          if (!email || !password) return new Response("Email and password are required.", { status: 400 });

          const result = await env.USER_DATA.prepare("SELECT id, password_hash FROM users WHERE email = ?").bind(email).first();
          if (!result) return new Response("Invalid email or password.", { status: 401 });

          const [saltHex, storedHashHex] = result.password_hash.split(":");
          const salt = Uint8Array.from(saltHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
          const passwordBuffer = new TextEncoder().encode(password);
          const hashBuffer = await scrypt(passwordBuffer, salt, 16384, 8, 1, 64);
          const hashHex = Array.from(hashBuffer).map((b) => b.toString(16).padStart(2, "0")).join("");

          if (hashHex === storedHashHex) {
              const payload = { sub: result.id, email: email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 };
              const token = await jwt.sign(payload, env.JWT_SECRET);
              return new Response(JSON.stringify({ token: token }), { status: 200, headers: { "Content-Type": "application/json" } });
          } else {
              return new Response("Invalid email or password.", { status: 401 });
          }
        }

        if (pathname === "/api/analyze" && request.method === "POST") {
          const authResult = await authenticateUser(request, env);
          if (authResult.error) return new Response(authResult.error, { status: authResult.status });
          
          const body = await request.json();
          const { resume: resumeText, job_description: jobDesc } = body;
          if (!resumeText) return new Response('Missing "resume" field in request body.', { status: 400 });

          const moderationPrompt = `
            You are a content moderator for a resume analysis AI.
            Your task is to determine if the provided text is a resume. A resume typically includes sections like "Experience", "Education", "Skills", contact information, or a summary. It does not have to contain all of these. Be flexible.
            Also, check if the user request (in the job description field) is appropriate. A request is appropriate if it asks for resume feedback OR if it is empty. It is inappropriate only if it asks for unrelated things (e.g., writing a story).

            Text to check: """${resumeText}"""
            User request: """${jobDesc || ""}"""

            Respond ONLY with a valid JSON object in the format:
            {"is_resume": boolean, "is_appropriate_request": boolean, "reason": "string"}
            - "is_resume" is true if the text is likely a resume or CV.
            - "is_appropriate_request" is true if the request is for resume feedback OR is empty.
            - "reason" is a brief, user-friendly explanation ONLY if a check fails.

            DO NOT add anything extra to the response, other than the JSON object!
          `;
          
          const moderationResponse = await env.AI.run(
            "@cf/meta/llama-3.1-8b-instruct-fast", 
            {
              messages: [{ role: "user", content: moderationPrompt }],
              response_format: { type: "json_object" },
            }
          );
          
          let moderationResult;
          try {
              const responseData = moderationResponse.response || moderationResponse;
              moderationResult = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
          } catch (e) {
              console.error("Moderation JSON parsing failed:", e);
              return new Response("Moderation check failed. Please try again.", { status: 500 });
          }
          
          if (!moderationResult.is_resume) {
            return new Response(moderationResult.reason || "The uploaded document does not appear to be a resume.", { status: 400 });
          }
          if (!moderationResult.is_appropriate_request) {
            return new Response(moderationResult.reason || "The request is not appropriate for this tool.", { status: 400 });
          }

          const resumeEmbeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [resumeText] });
          const resumeVector = resumeEmbeddingResponse.data[0];
          const similarTips = await env.RESUME_TIPS_INDEX.query(resumeVector, { topK: 3, returnMetadata: true });
          const context = similarTips.matches.map((match) => match.metadata.text).join("\n- ");
          
          let prompt = `You are an expert resume reviewer. Use the following best-practice tips to provide actionable feedback. Format your response in Markdown.\n\nContextual Tips:\n- ${context}\n\n---\nResume:\n${resumeText}`;
          if (jobDesc) {
              prompt += `\n\n---\nJob Description:\n${jobDesc}\n\nProvide the predicted ATS score, insights on how well the resume aligns with this role, and what can be improved.`;
          }
          
          const aiResponse = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
              messages: [{ role: "user", content: prompt }],
              max_tokens: 1500
          });

          const userId = authResult.user.sub;
          const feedbackText = aiResponse.response;
          try {
              await env.USER_DATA.prepare(
                  "INSERT INTO analysis_history (user_id, resume_text, job_description, ai_feedback) VALUES (?, ?, ?, ?)"
              ).bind(userId, resumeText, jobDesc || null, feedbackText).run();
          } catch (dbError) {
              console.error("Failed to save analysis history:", dbError);
          }

          return new Response(JSON.stringify({ feedback: feedbackText, context_tips: context.split("\n- ") }), { headers: { "Content-Type": "application/json" } });
        }

        if (pathname === "/api/history" && request.method === "GET") {
          const authResult = await authenticateUser(request, env);
          if (authResult.error) return new Response(authResult.error, { status: authResult.status });

          const userId = authResult.user.sub;

          const { results } = await env.USER_DATA.prepare(
            "SELECT id, timestamp, resume_text, job_description, ai_feedback FROM analysis_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20" // Added LIMIT
          ).bind(userId).all();

          return new Response(JSON.stringify(results || []), { 
            headers: { "Content-Type": "application/json" }
          });
        }
        
        return new Response("API endpoint not found", { status: 404 });

      } catch (err) {
          console.error("API Error:", err); 
          if (err.message.includes("UNIQUE constraint failed")) return new Response("User already exists.", { status: 400 });
          return new Response(`Error: ${err.message}`, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};