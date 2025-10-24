document.addEventListener('DOMContentLoaded', () => {
    // --- Globals ---
    const token = localStorage.getItem('authToken');
    let resumeTextContent = null; // Holds text extracted from PDF

    // --- PDF.js Setup ---
    const { pdfjsLib } = globalThis;
    if (pdfjsLib) {
        // Point to the CDN-hosted worker script
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;
    } else {
        console.error("PDF.js library failed to load. PDF functionality will be unavailable.");
        // Optionally, display an error to the user in the UI
        return;
    }

    // --- Elements ---
    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel = document.getElementById('theme-label');
    const newChatBtn = document.getElementById('new-chat-btn');
    const profileBtn = document.getElementById('profile-btn');
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-input');
    const sendBtn = document.getElementById('send-btn');
    const jobDescriptionInput = document.getElementById('job-description-input');
    const chatContainer = document.getElementById('chat-container');
    const fileNameDisplay = document.getElementById('file-name-display');
    const filePreviewContainer = document.getElementById('file-preview-container');
    const historyList = document.getElementById('history-list'); // History List Element

    // --- Initial Animation ---
    const welcomeMessage = document.querySelector('.welcome-message');
    if (welcomeMessage) {
      const welcomeH1 = welcomeMessage.querySelector('h1');
      const welcomeP = welcomeMessage.querySelector('p');
      welcomeMessage.classList.add('animate-fadeIn');
      if(welcomeH1) welcomeH1.classList.add('animate-slideUp');
      if(welcomeP) welcomeP.classList.add('animate-slideUp', 'delay-200');
    }

    // --- Auth Check ---
    if (!token) {
        window.location.href = '/login.html'; // Redirect if not logged in
        return;
    }

    // --- Theme Logic ---
    function applyTheme() {
        const currentTheme = localStorage.getItem('theme') || 'dark-mode';
        const isDarkMode = currentTheme === 'dark-mode';
        themeToggle.checked = isDarkMode;
        themeLabel.textContent = isDarkMode ? 'Dark Mode' : 'Light Mode';
        document.body.classList.remove('light-mode', 'dark-mode');
        document.body.classList.add(currentTheme);
    }
    applyTheme(); // Apply theme on initial load
    themeToggle.addEventListener('change', () => {
        const newTheme = themeToggle.checked ? 'dark-mode' : 'light-mode';
        localStorage.setItem('theme', newTheme);
        applyTheme();
    });

    // --- Helper Functions ---
    function clearFileUpload() {
        resumeTextContent = null;
        if (fileInput) fileInput.value = ''; // Clear file input
        if (filePreviewContainer) filePreviewContainer.innerHTML = '';
        if (fileNameDisplay) fileNameDisplay.textContent = '';
    }

    function showFileChip(fileName) {
        if (!filePreviewContainer) return;
        filePreviewContainer.innerHTML = `
            <div class="file-preview-chip">
                <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M13,9V3.5L18.5,9H13Z" /></svg>
                <span class="file-name">${fileName}</span>
                <button class="remove-file-btn" id="remove-file">&times;</button>
            </div>
        `;
        // Re-attach listener after innerHTML change
        document.getElementById('remove-file')?.addEventListener('click', clearFileUpload);
    }

    // --- History Functions ---
    async function fetchAndDisplayHistory() {
        if (!historyList || !token) return; // Ensure element and token exist
        try {
            const response = await fetch('/api/history', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                if (response.status === 401) { // Handle expired/invalid token
                    localStorage.removeItem('authToken');
                    window.location.href = '/login.html';
                    return;
                }
                throw new Error(`Failed to fetch history: ${response.statusText}`);
            }
            const historyData = await response.json();
            historyList.innerHTML = ''; // Clear previous items

            if (historyData && Array.isArray(historyData) && historyData.length > 0) {
                historyData.forEach(item => {
                    const button = document.createElement('button');
                    button.className = 'history-item';
                    const titleText = item.resume_text || `Analysis ${item.id}`;
                    button.textContent = new Date(item.timestamp).toLocaleString();
                    button.title = `Analyzed on ${new Date(item.timestamp).toLocaleString()}`;
                    button.onclick = () => loadHistoryItem(item);
                    historyList.appendChild(button);
                });
            } else {
                historyList.innerHTML = '<p class="history-empty">No history yet.</p>';
            }
        } catch (error) {
            console.error('Error fetching history:', error);
            historyList.innerHTML = '<p class="history-empty error">Could not load history.</p>';
        }
    }

    function loadHistoryItem(item) {
        if (!chatContainer) return;
        chatContainer.innerHTML = ''; // Clear current chat display

        // Reconstruct user's message
        let userInputHTML = '<div class="message-content">';
        userInputHTML += `
            <div class="file-preview-chip">
                <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M13,9V3.5L18.5,9H13Z" /></svg>
                <span class="file-name">Resume (from history)</span>
            </div>
        `;
        if (item.job_description) {
            const sanitizedJD = item.job_description.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            userInputHTML += `<div class="job-description-text"><strong>Job Description:</strong><p>${sanitizedJD.replace(/\n/g, '<br>')}</p></div>`;
        }
        userInputHTML += '</div>';
        appendMessage(userInputHTML, 'user');

        // Display AI's feedback
        appendMessage(item.ai_feedback || "Could not load feedback.", 'ai'); // Append first
        updateLastMessage(item.ai_feedback || "Could not load feedback."); // Then parse Markdown
    }

    // --- Event Listeners ---
    newChatBtn?.addEventListener('click', () => {
        if (!chatContainer) return;
        chatContainer.innerHTML = `
            <div class="welcome-message animate-fadeIn">
                <h1 class="animate-slideUp">Resume Read</h1>
                <p class="animate-slideUp delay-200">Your resume proofreader</p>
            </div>`;
        if (jobDescriptionInput) jobDescriptionInput.value = '';
        clearFileUpload();
    });

    profileBtn?.addEventListener('click', () => {
        if (confirm('Are you sure you want to log out?')) {
            localStorage.removeItem('authToken');
            window.location.href = '/login.html';
        }
    });

    uploadBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (event) => {
        const file = event.target.files?.[0]; // Use optional chaining
        if (!file || file.type !== 'application/pdf') {
            clearFileUpload();
            if (file && fileNameDisplay) fileNameDisplay.textContent = 'Please select a valid PDF file.';
            return;
        }
        if (fileNameDisplay) fileNameDisplay.textContent = `Reading: ${file.name}...`;

        const fileReader = new FileReader();
        fileReader.onload = async function() {
            try {
                if (!pdfjsLib) throw new Error("PDF.js not loaded.");
                const typedarray = new Uint8Array(this.result);
                // Correctly pass data to getDocument
                const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    fullText += textContent.items.map(item => item.str).join(' ') + '\n';
                }
                resumeTextContent = fullText;
                if (fileNameDisplay) fileNameDisplay.textContent = '';
                showFileChip(file.name);
            } catch (error) {
                console.error("PDF Read Error:", error);
                if (fileNameDisplay) fileNameDisplay.textContent = 'Error reading PDF file.';
                clearFileUpload();
            }
        };
        fileReader.onerror = () => { // Handle FileReader errors
             console.error("FileReader Error");
             if (fileNameDisplay) fileNameDisplay.textContent = 'Error reading file.';
             clearFileUpload();
        };
        fileReader.readAsArrayBuffer(file);
    });

    sendBtn?.addEventListener('click', handleSend);

    jobDescriptionInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // --- Core Functions ---
    async function handleSend() {
        if (!resumeTextContent) {
            alert('Please upload a resume PDF first.');
            return;
        }
        if (!token) {
             window.location.href = '/login.html'; // Re-check token just in case
             return;
        }

        const jobDescription = jobDescriptionInput?.value.trim() || "";
        const currentWelcome = document.querySelector('.welcome-message');
        if (currentWelcome && chatContainer) chatContainer.removeChild(currentWelcome);

        let messageHTML = '<div class="message-content">';
        const currentChip = filePreviewContainer?.querySelector('.file-preview-chip');
        if (currentChip) {
            messageHTML += currentChip.outerHTML;
        } else {
             // Fallback if chip isn't there (e.g., text was pasted) - though current logic requires PDF
             messageHTML += `<div class="file-preview-chip"><span class="file-name">Resume Text</span></div>`
        }
        if (jobDescription) {
            const sanitizedJD = jobDescription.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            messageHTML += `<div class="job-description-text"><strong>Job Description:</strong><p>${sanitizedJD.replace(/\n/g, '<br>')}</p></div>`;
        }
        messageHTML += '</div>';

        appendMessage(messageHTML, 'user');
        appendMessage('Analyzing...', 'ai', true); // Show loading state

        const resumeDataToSend = resumeTextContent; // Use the extracted text
        const jobDescToSend = jobDescription;

        // Clear inputs after grabbing data
        clearFileUpload();
        if (jobDescriptionInput) jobDescriptionInput.value = '';

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ resume: resumeDataToSend, job_description: jobDescToSend })
            });

            if (!response.ok) {
                 if (response.status === 401) { // Handle specific auth error during analysis
                    localStorage.removeItem('authToken');
                    window.location.href = '/login.html';
                    return; // Stop execution
                 }
                 throw new Error(`Analysis failed: ${await response.text() || response.statusText}`);
            }
            const data = await response.json();
            updateLastMessage(data.feedback);
            fetchAndDisplayHistory(); // Refresh history list
        } catch (error) {
            console.error("Analysis API Error:", error);
            updateLastMessage(`Sorry, an error occurred during analysis: ${error.message}`);
        }
    }

    function appendMessage(content, sender, isLoading = false) {
        if (!chatContainer) return;
        const aiAvatar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12,2A10,10,0,0,0,2,12a10,10,0,0,0,10,10,10,10,0,0,0,10-10A10,10,0,0,0,12,2Z" /></svg>`;
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${sender}`;

        if (sender === 'ai') {
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'avatar';
            avatarDiv.innerHTML = aiAvatar;
            wrapper.appendChild(avatarDiv);
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        // Render user HTML directly, parse AI Markdown if 'marked' is available
        if (sender === 'ai' && !isLoading && window.marked) {
             try {
                messageDiv.innerHTML = window.marked.parse(content || ""); // Handle null/undefined content
             } catch(e) {
                 console.error("Markdown parsing error:", e);
                 messageDiv.textContent = content || ""; // Fallback to text
             }
        } else {
             messageDiv.innerHTML = content || ""; // Keep user HTML or loading text
        }

        if (isLoading) messageDiv.id = 'loading-indicator';

        wrapper.appendChild(messageDiv);
        chatContainer.appendChild(wrapper);
        // Scroll to bottom after adding message
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function updateLastMessage(content) {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator && window.marked) {
             try {
                loadingIndicator.innerHTML = window.marked.parse(content || "");
                loadingIndicator.removeAttribute('id'); // Remove ID
             } catch(e) {
                 console.error("Markdown parsing error on update:", e);
                 loadingIndicator.textContent = content || ""; // Fallback
                 loadingIndicator.removeAttribute('id');
             }
        } else {
             // If marked isn't loaded or it's not the loading indicator, try updating last AI message
             const lastAiMessage = chatContainer?.querySelector('.message-wrapper.ai:last-child .message');
             if (lastAiMessage && window.marked) {
                 try {
                     lastAiMessage.innerHTML = window.marked.parse(content || "");
                 } catch(e) {
                     console.error("Markdown parsing error on last message:", e);
                     lastAiMessage.textContent = content || "";
                 }
             } else if (lastAiMessage) {
                 lastAiMessage.textContent = content || ""; // Fallback if marked fails
             }
        }
        if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll after update
    }

    // --- Initial Load ---
    fetchAndDisplayHistory(); // Fetch history on page load

});
