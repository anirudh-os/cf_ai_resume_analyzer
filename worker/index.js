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
    return { user: payload };
  } catch (err) {
    return { error: "Invalid token.", status: 401 };
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
          
          const resumeEmbeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [resumeText] });
          const resumeVector = resumeEmbeddingResponse.data[0];
          const similarTips = await env.RESUME_TIPS_INDEX.query(resumeVector, { topK: 3, returnMetadata: true });
          const context = similarTips.matches.map((match) => match.metadata.text).join("\n- ");
          
          let prompt = `You are an expert resume reviewer. Use the following best-practice tips to provide actionable feedback.\n\nContextual Tips:\n- ${context}\n\n---\nResume:\n${resumeText}`;
          if (jobDesc) {
              prompt += `\n\n---\nJob Description:\n${jobDesc}\n\nProvide the predicted ATS score, insights on how well the resume aligns with this role, and what can be improved.`;
          }
          
          // --- FIX: Increased token limit for a complete response ---
          const aiResponse = await env.AI.run("@cf/mistral/mistral-7b-instruct-v0.1", { 
              messages: [{ role: "user", content: prompt }],
              max_tokens: 1500 
          });

          return new Response(JSON.stringify({ feedback: aiResponse.response, context_tips: context.split("\n- ") }), { headers: { "Content-Type": "application/json" } });
        }
        
        return new Response("API endpoint not found", { status: 404 });

      } catch (err) {
          if (err.message.includes("UNIQUE constraint failed")) return new Response("User already exists.", { status: 400 });
          return new Response(`Error: ${err.message}`, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};