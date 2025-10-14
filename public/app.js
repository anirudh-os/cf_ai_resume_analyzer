document.addEventListener('DOMContentLoaded', () => {
    // --- Globals ---
    const token = localStorage.getItem('authToken');
    let resumeTextContent = null;
    
    // --- PDF.js Setup ---
    const { pdfjsLib } = globalThis;
    if (pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;
    } else {
        console.error("PDF.js library failed to load.");
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

    // --- WELCOME ANIMATION ---
    const welcomeMessage = document.querySelector('.welcome-message');
    if (welcomeMessage) {
        const welcomeH1 = welcomeMessage.querySelector('h1');
        const welcomeP = welcomeMessage.querySelector('p');
        
        // Add classes to trigger the animation
        welcomeMessage.classList.add('animate-fadeIn');
        if(welcomeH1) welcomeH1.classList.add('animate-slideUp');
        if(welcomeP) welcomeP.classList.add('animate-slideUp', 'delay-200');
    }
    
    // --- Auth Check ---
    if (!token) {
        window.location.href = '/login.html';
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
    applyTheme();
    themeToggle.addEventListener('change', () => {
        const newTheme = themeToggle.checked ? 'dark-mode' : 'light-mode';
        localStorage.setItem('theme', newTheme);
        applyTheme();
    });

    // --- Helper Functions ---
    function clearFileUpload() {
        resumeTextContent = null;
        fileInput.value = '';
        filePreviewContainer.innerHTML = '';
        fileNameDisplay.textContent = '';
    }
    function showFileChip(fileName) {
        filePreviewContainer.innerHTML = `
            <div class="file-preview-chip">
                <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M13,9V3.5L18.5,9H13Z" /></svg>
                <span class="file-name">${fileName}</span>
                <button class="remove-file-btn" id="remove-file">&times;</button>
            </div>
        `;
        document.getElementById('remove-file').addEventListener('click', clearFileUpload);
    }

    // --- Event Listeners ---
    newChatBtn.addEventListener('click', () => {
        // When creating a new chat, re-add the welcome message with animation classes
        chatContainer.innerHTML = `
            <div class="welcome-message animate-fadeIn">
                <h1 class="animate-slideUp">Resume Read</h1>
                <p class="animate-slideUp delay-200">Your resume proofreader</p>
            </div>`;
        jobDescriptionInput.value = '';
        clearFileUpload();
    });
    profileBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to log out?')) {
            localStorage.removeItem('authToken');
            window.location.href = '/login.html';
        }
    });
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file || file.type !== 'application/pdf') {
            clearFileUpload();
            if (file) fileNameDisplay.textContent = 'Please select a valid PDF file.';
            return;
        }
        fileNameDisplay.textContent = `Reading: ${file.name}...`;
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            try {
                const typedarray = new Uint8Array(this.result);
                const pdf = await pdfjsLib.getDocument(typedarray).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    fullText += textContent.items.map(item => item.str).join(' ') + '\n';
                }
                resumeTextContent = fullText;
                fileNameDisplay.textContent = '';
                showFileChip(file.name);
            } catch (error) {
                fileNameDisplay.textContent = 'Error reading PDF file.';
                clearFileUpload();
            }
        };
        fileReader.readAsArrayBuffer(file);
    });
    sendBtn.addEventListener('click', handleSend);
    jobDescriptionInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });

    // --- Core Functions ---
    async function handleSend() {
        if (!resumeTextContent) {
            alert('Please upload a resume to analyze.');
            return;
        }
        const jobDescription = jobDescriptionInput.value.trim();
        if (document.querySelector('.welcome-message')) chatContainer.innerHTML = '';

        let messageHTML = '<div class="message-content">';
        messageHTML += filePreviewContainer.innerHTML;
        if (jobDescription) {
            const sanitizedJD = jobDescription.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            messageHTML += `<div class="job-description-text"><strong>Job Description:</strong><p>${sanitizedJD.replace(/\n/g, '<br>')}</p></div>`;
        }
        messageHTML += '</div>';

        appendMessage(messageHTML, 'user');
        appendMessage('Analyzing...', 'ai', true);

        const resumeDataToSend = resumeTextContent;
        const jobDescToSend = jobDescription;
        
        clearFileUpload();
        jobDescriptionInput.value = '';

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
                body: JSON.stringify({ resume: resumeDataToSend, job_description: jobDescToSend })
            });
            if (!response.ok) throw new Error(`Analysis failed: ${await response.text()}`);
            const data = await response.json();
            updateLastMessage(data.feedback);
        } catch (error) {
            updateLastMessage(`An error occurred: ${error.message}`);
        }
    }

    function appendMessage(content, sender, isLoading = false) {
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
        messageDiv.innerHTML = content;
        if (isLoading) messageDiv.id = 'loading-indicator';
        wrapper.appendChild(messageDiv);
        chatContainer.appendChild(wrapper);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function updateLastMessage(content) {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.innerHTML = window.marked.parse(content);
            loadingIndicator.id = '';
        } else {
            const lastMessage = chatContainer.querySelector('.message:last-child');
            if(lastMessage) lastMessage.innerHTML = window.marked.parse(content);
        }
    }
});