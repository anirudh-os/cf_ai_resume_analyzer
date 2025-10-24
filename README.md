# AI Resume Analyzer

[AI Resume Analyzer](https://ai-resume-analyzer.koundinyaani05.workers.dev/) is a full-stack, serverless application designed to provide intelligent, context-aware feedback on user resumes. Built on the **Cloudflare stack**, it leverages a **Retrieval-Augmented Generation (RAG)** pipeline to offer high-quality analysis grounded in a curated knowledge base of resume best practices.

---

## Features

### Secure User Authentication
- Users can sign up and log in securely.
- Passwords are hashed using **scrypt-js**.
- Sessions are managed with **JSON Web Tokens (JWTs)**.

### Intelligent RAG Pipeline
- Analysis uses **Retrieval-Augmented Generation**.
- Retrieves relevant resume tips from a **Vectorize** knowledge base.
- Constructs a **context-aware AI prompt** for nuanced feedback.

### Input Moderation
- Preliminary AI check ensures uploaded documents are valid resumes.
- Verifies user requests are appropriate for the tool.
- Prevents misuse or irrelevant inputs before analysis.

### Client-Side PDF Parsing
- Uses **pdf.js** to parse resumes directly in the browser.
- Only extracted text is sent to the backend, improving performance and privacy.

### Analysis History
- Saves past analysis results (resume, job description, feedback) linked to the user in **Cloudflare D1**.
- Allows users to view and reload previous analyses via the sidebar.

### Dynamic UI
- Clean, responsive single-page application.
- Features file uploads, chat-style interactions, history navigation, and light/dark mode toggling.

---

## Tech Stack

| Layer | Technology |
|-------|-------------|
| **Backend** | Cloudflare Workers |
| **Database** | Cloudflare D1 |
| **Vector Database** | Cloudflare Vectorize |
| **AI/LLM** | Cloudflare Workers AI (Llama 3.3 70B Instruct) |
| **Frontend** | Vanilla JavaScript, HTML5, CSS3 |

### Libraries Used
- [`pdf.js`](https://mozilla.github.io/pdf.js/) – Client-side PDF parsing  
- [`marked.js`](https://marked.js.org/) – Render Markdown responses  
- [`scrypt-js`](https://www.npmjs.com/package/scrypt-js) – Password hashing  
- [`@tsndr/cloudflare-worker-jwt`](https://github.com/tsndr/cloudflare-worker-jwt) – JWT session management  

---

## Local Development Setup

To run this project locally, ensure you have **Node.js** and the **Wrangler CLI** installed.

### 1. Clone the Repository
```bash
git clone https://github.com/anirudh-os/cf_ai_resume_analyzer.git
cd cf_ai_resume_analyzer
```
### 2. Install Dependencies
```bash
npm install
```
### 3. Set Up Environment Secrets
The application requires a secret key for signing JWTs. This is handled using a .dev.vars file for local development.

1. Generate a secret key by running the following command in your terminal:
   ```bash
   openssl rand -base64 32
   ```
2. Create a file named `.dev.vars` in the root of the project.
3. Add the generated key to the file:
   ```bash
   JWT_SECRET="your_generated_secret_key_here"
   ```
4. Run the Development Server
   ```bash
   npx wrangler dev
   ```
Your application will be available at http://localhost:8787. The server provides your frontend, runs your backend Worker, and gives you access to your remote D1 and Vectorize bindings.

## Deployment
The application is deployed on Cloudflare Pages. To deploy your own version, simply run:
```bash
npx wrangler deploy
```

---

## API Endpoints

All API endpoints are prefixed with `/api`.

-   `POST /api/signup`: Creates a new user account.

-   `POST /api/login`: Authenticates a user and returns a JWT.

-   `POST /api/analyze`: A protected endpoint that accepts resume text and an optional job description, returning an AI-generated analysis. Requires a valid JWT in the `Authorization` header.
