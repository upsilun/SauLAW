const chatHistory = document.getElementById('chat-history');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const loadingIndicator = document.getElementById('loading-indicator');
const systemPromptInput = document.getElementById('system-prompt');
const fileUploadInput = document.getElementById('file-upload');
const fileNameDisplay = document.getElementById('file-name');
const clearFileBtn = document.getElementById('clear-file-btn');

let fileContent = '';

// Set up PDF.js worker
if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

// Handle file selection
fileUploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    fileNameDisplay.textContent = `Processing: ${file.name}...`;
    clearFileBtn.classList.add('hidden');

    if (file.type === 'text/plain') {
        const reader = new FileReader();
        reader.onload = (e) => {
            fileContent = e.target.result;
            fileNameDisplay.textContent = file.name;
            clearFileBtn.classList.remove('hidden');
        };
        reader.readAsText(file);
    } else if (file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const arrayBuffer = e.target.result;
            try {
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                let textContent = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const text = await page.getTextContent();
                    textContent += text.items.map(s => s.str).join(' ');
                }
                fileContent = textContent;
                fileNameDisplay.textContent = file.name;
                clearFileBtn.classList.remove('hidden');
            } catch (error) {
                console.error('Error parsing PDF:', error);
                fileNameDisplay.textContent = 'Error reading PDF.';
                fileContent = '';
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        fileNameDisplay.textContent = 'Unsupported file type.';
        fileContent = '';
    }
});

// Handle clear file button
clearFileBtn.addEventListener('click', () => {
    fileContent = '';
    fileUploadInput.value = ''; // Reset file input
    fileNameDisplay.textContent = 'No file selected.';
    clearFileBtn.classList.add('hidden');
});

userInput.addEventListener('input', () => {
    sendBtn.disabled = userInput.value.trim() === '';
});

sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && !sendBtn.disabled) {
        sendMessage();
    }
});

function sendMessage() {
    const userQuery = userInput.value.trim();
    if (userQuery === '') return;

    appendMessage(userQuery, 'user');
    
    userInput.value = '';
    sendBtn.disabled = true;

    loadingIndicator.classList.remove('hidden');
    scrollToBottom();

    callGeminiAPI(userQuery);
}

function appendMessage(message, sender, sources = []) {
    const messageWrapper = document.createElement('div');
    messageWrapper.classList.add('flex', 'flex-col', sender === 'user' ? 'items-end' : 'items-start');

    const messageBubble = document.createElement('div');
    messageBubble.classList.add('chat-bubble', sender === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai');
    messageBubble.innerHTML = message.replace(/\n/g, '<br>');

    // Detect Arabic letters
    const hasArabic = /[\u0600-\u06FF]/.test(message);
    if (hasArabic) {
        messageBubble.setAttribute('dir', 'rtl');
        messageBubble.classList.add('text-right');
    } else {
        messageBubble.setAttribute('dir', 'ltr');
        messageBubble.classList.add('text-left');
    }

    messageWrapper.appendChild(messageBubble);

    if (sources.length > 0) {
        const sourcesContainer = document.createElement('div');
        sourcesContainer.classList.add('mt-2', 'mb-2', 'text-xs', 'text-gray-500', 'w-full', 'max-w-[80%]');
        sourcesContainer.innerHTML = '<strong>Sources:</strong>';

        const sourcesList = document.createElement('ol');
        sourcesList.classList.add('list-decimal', 'list-inside', 'pl-2');
        
        sources.forEach(source => {
            const sourceItem = document.createElement('li');
            const sourceLink = document.createElement('a');
            sourceLink.href = source.uri;
            sourceLink.textContent = source.title;
            sourceLink.target = '_blank';
            sourceLink.classList.add('text-white-600', 'hover:underline');
            sourceItem.appendChild(sourceLink);
            sourcesList.appendChild(sourceItem);
        });
        sourcesContainer.appendChild(sourcesList);
        messageWrapper.appendChild(sourcesContainer);
    }

    chatHistory.appendChild(messageWrapper);
    scrollToBottom();
}

function scrollToBottom() {
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function callGeminiAPI(userQuery) {
    // IMPORTANT: Add your API key here
    const apiKey = ""; // <-- PASTE YOUR API KEY HERE
    if (apiKey === "") {
        loadingIndicator.classList.add('hidden');
        appendMessage("API Key is missing. Please add your Gemini API key to the script section of this file.", 'ai');
        return;
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const defaultSystemPrompt = document.getElementById("system-prompt").value;
    const customSystemPrompt = systemPromptInput.value.trim();

    let finalQuery = userQuery;
    if (fileContent) {
            // Truncate content to avoid exceeding API limits. 100k characters is a safe limit.
        const MAX_CONTEXT_LENGTH = 100000;
        let context = fileContent;
        if(context.length > MAX_CONTEXT_LENGTH) {
            context = context.substring(0, MAX_CONTEXT_LENGTH);
            console.warn("File content truncated to " + MAX_CONTEXT_LENGTH + " characters.");
        }
        finalQuery = `Based on the following context, please answer the user's question.\n\n--- CONTEXT START ---\n${context}\n--- CONTEXT END ---\n\nQuestion: ${userQuery}`;
    }

    const payload = {
        contents: [{ parts: [{ text: finalQuery }] }],
        tools: fileContent ? [] : [{ "google_search": {} }],
        systemInstruction: {
            parts: [{ text: customSystemPrompt || defaultSystemPrompt }]
        },
    };
    
    let retries = 3;
    let delay = 1000;

    while(retries > 0) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorBody = await response.json();
                console.error('API Error Response:', errorBody);
                throw new Error(`HTTP error! status: ${response.status} - ${errorBody.error?.message || 'Unknown error'}`);
            }

            const result = await response.json();
            const candidate = result.candidates?.[0];

            let aiResponse = "Sorry, I couldn't generate a response. Please try again.";
            let sources = [];

            if (candidate && candidate.content?.parts?.[0]?.text) {
                aiResponse = candidate.content.parts[0].text;
                
                const groundingMetadata = candidate.groundingMetadata;
                if (groundingMetadata && groundingMetadata.groundingAttributions) {
                    sources = groundingMetadata.groundingAttributions
                        .map(attribution => ({
                            uri: attribution.web?.uri,
                            title: attribution.web?.title,
                        }))
                        .filter(source => source.uri && source.title);
                }
            } else if (candidate && candidate.finishReason !== 'STOP') {
                    aiResponse = `My response was stopped for the following reason: ${candidate.finishReason}. Please check your prompt or the content safety settings if applicable.`
            }

            loadingIndicator.classList.add('hidden');
            appendMessage(aiResponse, 'ai', sources);
            return;

        } catch (error) {
            console.error('API Call Failed:', error);
            retries--;
            if (retries === 0) {
                    loadingIndicator.classList.add('hidden');
                    appendMessage(`I'm having trouble connecting. Error: ${error.message}. Please check the console and ensure your API key is correct.`, 'ai');
            } else {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            }
        }
    }
}


function drop_menu() {
    if(document.getElementById("drop_menu").style.display == "none"){
        document.getElementById("drop_menu").style.display = "block"
    }else{
        document.getElementById("drop_menu").style.display = "none"
    }
}