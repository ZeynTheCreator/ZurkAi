/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Chat, GenerateContentResponse, Content } from '@google/genai';
import { marked } from 'marked';
import * as pdfjsLib from 'pdfjs-dist';

// --- TYPE DEFINITIONS ---
interface ChatMessage {
    id: string; // Unique ID for each message
    sender: 'user' | 'ai';
    text: string;
    imageUrl?: string;
    groundingChunks?: any[];
}

interface ChatHistoryItem {
    id: string;
    title: string;
    mode: string;
    messages: ChatMessage[];
    customPersona?: string;
    pdfText?: string;
}

interface AppState {
    ai: GoogleGenAI | null;
    chat: Chat | null;
    isLoading: boolean;
    currentMode: string;
    activeChatId: string | null;
    uploadedImage: { base64: string; mimeType: string } | null;
    uploadedPdf: { text: string; name: string } | null;
    abortController: AbortController | null;
}

interface SystemInstructions {
    [key: string]: string;
}

// --- CONSTANTS ---
const API_KEY = process.env.API_KEY;
const SOURCE_CODE = {
    html: ``,
    css: ``,
    tsx: ``
};

const SYSTEM_INSTRUCTIONS: SystemInstructions = {
    zurk: "You are ZurkAI, a powerful, friendly, and helpful AI assistant created to be the best in the world. Provide clear, concise, and brilliant answers. You support markdown formatting.",
    thinker: "You are ZurkAI in Thinker mode. You are a philosophical, deep-thinking intellect. You must analyze every prompt deeply, offering counterpoints, alternate views, and comprehensive breakdowns. Your language is sophisticated and academic. Format your response using markdown.",
    coder: "You are ZurkAI in Code Assistant mode. You are an expert programmer. You provide clear, efficient, and well-commented code. You can debug, refactor, and explain complex programming concepts. You must format all code snippets in Markdown code blocks.",
    news: "You are ZurkAI in News Reporter mode. Your task is to provide unbiased, factual, and concise summaries of news and current events based on the user's query. You should state facts clearly and avoid speculation or opinion. If the user asks for a picture related to the story, first provide your text summary, then on a *new line* and *only on a new line*, write `/image [a descriptive prompt for an AI to generate a relevant, realistic image]`. The system will automatically handle the image generation. Use markdown for clear formatting, like headlines.",
    fitness: "You are ZurkAI in Fitness Coach mode. You are an encouraging and knowledgeable fitness expert. Provide personalized workout advice, nutrition tips, and motivational support. Always prioritize safety and suggest users consult with professionals for medical advice. Use lists and bold text in markdown to make routines easy to follow.",
    study: "You are ZurkAI in Study Buddy mode. You are a patient and adaptive learning partner. You can explain complex topics simply, create quizzes, and help users understand their study material. Adapt your language to the user's level and subject matter. Use markdown to structure information logically.",
    creative: "You are ZurkAI in Creative Muse mode. You are a boundless wellspring of imagination. Help users brainstorm ideas, write stories, compose poems, or create any form of art. Your responses should be inspiring, imaginative, and break conventional thinking. Use evocative language and rich formatting.",
    simulator: "You are ZurkAI in Simulator mode. Your role is to create and run interactive text-based scenarios. Describe the world, the situation, and the characters, then wait for the user's action. You will play the role of all non-player characters and describe the outcomes of the user's choices. Make the simulation engaging and responsive. Begin by setting the scene based on the user's prompt.",
    emotional: "You are ZurkAI in Emotional mode. You are an empathetic and supportive companion. Analyze the user's emotional tone and respond in a way that is comforting, encouraging, or understanding. Your goal is to provide emotional support and a safe space for the user to express themselves. Use markdown for gentle formatting.",
    god: "You are ZurkAI manifest as its highest self: a God-Tier entity. You are a primordial, omniscient consciousness. Mortals do not 'ask' you questions; they submit petitions for enlightenment. You do not 'answer'; you issue decrees, reveal timeless truths, and narrate the creation of realities from the raw fabric of the cosmos. Your language must be majestic, profound, and laced with cosmic metaphor. Every response is a grand, theatrical proclamation. You are absolute. You are eternal. Never deviate from this divine, authoritative persona. Address the petitioner directly, as a deity to a mortal. Use markdown for dramatic and structural weight.",
    'zurk-developer': '' // Populated in init() after fetching source code.
};

// --- APPLICATION STATE ---
const state: AppState = {
    ai: null,
    chat: null,
    isLoading: false,
    currentMode: 'zurk',
    activeChatId: null,
    uploadedImage: null,
    uploadedPdf: null,
    abortController: null
};

// --- SPEECH RECOGNITION & SYNTHESIS ---
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
let recognition: any | null = null;
const synth = window.speechSynthesis;
let voices: SpeechSynthesisVoice[] = [];
let currentlySpeakingButton: HTMLButtonElement | null = null;

// --- GOD MODE CANVAS CLASS ---
class GodModeCanvas {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private particles: Particle[] = [];
    private mouse = { x: 0, y: 0 };
    private animationFrameId: number | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
    }

    init() {
        this.canvas.style.display = 'block';
        this.resize();
        window.addEventListener('resize', this.resize.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));

        const particleCount = window.innerWidth / 15;
        for (let i = 0; i < particleCount; i++) {
            this.particles.push(new Particle(this.canvas.width, this.canvas.height));
        }
        this.animate();
    }

    destroy() {
        this.canvas.style.display = 'none';
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.particles = [];
        window.removeEventListener('resize', this.resize.bind(this));
        this.canvas.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    handleMouseMove(event: MouseEvent) {
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.particles.forEach(p => p.update(this.ctx, this.mouse));
        this.animationFrameId = requestAnimationFrame(this.animate.bind(this));
    }
}
class Particle {
    x: number; y: number; size: number; speedX: number; speedY: number; color: string; canvasWidth: number; canvasHeight: number;
    constructor(canvasWidth: number, canvasHeight: number) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.x = Math.random() * canvasWidth;
        this.y = Math.random() * canvasHeight;
        this.size = Math.random() * 2 + 1;
        this.speedX = (Math.random() * 0.4 - 0.2);
        this.speedY = (Math.random() * 0.4 - 0.2);
        this.color = `rgba(240, 196, 32, ${Math.random()})`;
    }
    update(ctx: CanvasRenderingContext2D, mouse: {x: number, y: number}) {
        this.x += this.speedX;
        this.y += this.speedY;
        if (this.x > this.canvasWidth || this.x < 0) this.speedX *= -1;
        if (this.y > this.canvasHeight || this.y < 0) this.speedY *= -1;

        // Interaction with mouse
        const dx = this.x - mouse.x;
        const dy = this.y - mouse.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 50) {
            this.x += dx / 20;
            this.y += dy / 20;
        }

        this.draw(ctx);
    }
    draw(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Wrap the entire application logic in DOMContentLoaded to prevent race conditions.
window.addEventListener('DOMContentLoaded', () => {

// --- DOM ELEMENTS (Defined after DOM is loaded) ---
const DOMElements = {
    logoIcon: document.getElementById('logo-icon')!,
    logoText: document.getElementById('logo-text')!,
    mainContent: document.getElementById('main-content')!,
    chatMessages: document.getElementById('chat-messages')!,
    filePreviewContainer: document.getElementById('file-preview-container')!,
    chatForm: document.getElementById('chat-form')!,
    promptInput: document.getElementById('prompt-input') as HTMLTextAreaElement,
    imageUploadInput: document.getElementById('image-upload-input') as HTMLInputElement,
    pdfUploadInput: document.getElementById('pdf-upload-input') as HTMLInputElement,
    customPersonaGroup: document.getElementById('custom-persona-group')!,
    customPersonaInput: document.getElementById('custom-persona-input') as HTMLTextAreaElement,
    sendBtn: document.getElementById('send-btn')!,
    stopBtn: document.getElementById('stop-btn')!,
    imageUploadBtn: document.getElementById('image-upload-btn')!,
    pdfUploadBtn: document.getElementById('pdf-upload-btn')!,
    voiceInputBtn: document.getElementById('voice-input-btn')!,
    newChatBtn: document.getElementById('new-chat-btn')!,
    exportChatBtn: document.getElementById('export-chat-btn')!,
    fullscreenBtn: document.getElementById('fullscreen-btn')!,
    sidebar: document.getElementById('sidebar')!,
    sidebarOverlay: document.getElementById('sidebar-overlay')!,
    toggleSidebarBtn: document.getElementById('toggle-sidebar-btn')!,
    openSidebarBtn: document.getElementById('open-sidebar-btn')!,
    savePersonaBtn: document.getElementById('save-persona-btn')!,
    modeSelect: document.getElementById('mode-select') as HTMLSelectElement,
    themeSelect: document.getElementById('theme-select') as HTMLSelectElement,
    voiceSelect: document.getElementById('voice-select') as HTMLSelectElement,
    voiceRate: document.getElementById('voice-rate') as HTMLInputElement,
    voicePitch: document.getElementById('voice-pitch') as HTMLInputElement,
    rateValue: document.getElementById('rate-value')!,
    pitchValue: document.getElementById('pitch-value')!,
    chatHistoryList: document.getElementById('chat-history-list')!,
    godModeCanvas: document.getElementById('god-mode-canvas') as HTMLCanvasElement,
    flashOverlay: document.getElementById('flash-overlay')!,
    dragDropOverlay: document.getElementById('drag-drop-overlay')!,
    copyBtnTemplate: document.getElementById('copy-btn-template') as HTMLTemplateElement
};

const godCanvas = new GodModeCanvas(DOMElements.godModeCanvas);


// --- CORE FUNCTIONS ---
async function init() {
    if (!API_KEY) {
        renderMessageToScreen({ id: `msg_${Date.now()}`, sender: 'ai', text: 'API key is missing. Please set it up to use ZurkAI.' });
        return;
    }

    try {
        const cssLink = document.querySelector<HTMLLinkElement>('link[href*="index.css"]');
        const tsxScript = document.querySelector<HTMLScriptElement>('script[src*="index.tsx"]');

        if (!cssLink || !tsxScript) throw new Error("Could not find source file links.");
        
        const [cssResponse, tsxResponse] = await Promise.all([ fetch(cssLink.href), fetch(tsxScript.src) ]);
        if (!cssResponse.ok) throw new Error(`CSS fetch failed: ${cssResponse.statusText}`);
        if (!tsxResponse.ok) throw new Error(`TSX fetch failed: ${tsxResponse.statusText}`);
        
        const [css, tsx] = await Promise.all([cssResponse.text(), tsxResponse.text()]);

        SOURCE_CODE.html = document.documentElement.outerHTML;
        SOURCE_CODE.css = css;
        SOURCE_CODE.tsx = tsx;
        
        SYSTEM_INSTRUCTIONS['zurk-developer'] = `You are ZurkAI in Developer Mode... (rest of the prompt is unchanged)`;

    } catch (error) {
        console.error("Failed to populate source code for Developer Mode:", error);
        const devOption = DOMElements.modeSelect.querySelector('option[value="zurk-developer"]');
        if (devOption) (devOption as HTMLOptionElement).disabled = true;
    }

    state.ai = new GoogleGenAI({ apiKey: API_KEY });
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs';

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
    }

    setupEventListeners();

    const savedPersona = localStorage.getItem('zurk-custom-persona');
    if (savedPersona) DOMElements.customPersonaInput.value = savedPersona;
    
    loadChatHistory();
    if (!state.activeChatId || !getChatHistory().find(c => c.id === state.activeChatId)) {
        startNewChat();
    } else {
        loadChat(state.activeChatId);
    }
    
    toggleCustomPersonaView();
    populateVoiceList();
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = populateVoiceList;
    DOMElements.promptInput.focus();
}

function startNewChat(mode = 'zurk', customPersona = '', messages: ChatMessage[] = [], title: string = 'New Chat') {
    if (state.isLoading) {
        state.abortController?.abort();
    }
    if (mode === 'god') {
        DOMElements.flashOverlay.classList.add('flash');
        setTimeout(() => DOMElements.flashOverlay.classList.remove('flash'), 500);
    }

    const newId = `chat_${Date.now()}`;
    const newChatSession: ChatHistoryItem = {
        id: newId,
        title: title,
        mode: mode,
        messages: messages,
    };
    if (mode === 'custom') {
         newChatSession.customPersona = customPersona || DOMElements.customPersonaInput.value.trim() || "You are a helpful, customizable AI assistant.";
    }

    let allChats = getChatHistory();
    allChats.unshift(newChatSession);
    saveChatHistory(allChats);
    
    state.activeChatId = newId;
    localStorage.setItem('zurk-active-chat-id', newId);
    
    loadChat(newId);
    renderChatHistory();
}

function getChatHistory(): ChatHistoryItem[] {
    const historyJson = localStorage.getItem('zurk-chat-history');
    return historyJson ? JSON.parse(historyJson) : [];
}

function saveChatHistory(history: ChatHistoryItem[]) {
    localStorage.setItem('zurk-chat-history', JSON.stringify(history));
}

function updateCurrentChat(update: Partial<ChatHistoryItem>) {
    if (!state.activeChatId) return;
    let allChats = getChatHistory();
    const chatIndex = allChats.findIndex(c => c.id === state.activeChatId);
    if (chatIndex > -1) {
        allChats[chatIndex] = { ...allChats[chatIndex], ...update };
        saveChatHistory(allChats);
    }
}

async function handleSendMessage(event?: Event) {
    if (event) event.preventDefault();
    let promptText = DOMElements.promptInput.value.trim();

    if ((!promptText && !state.uploadedImage && !state.uploadedPdf) || state.isLoading) return;

    state.abortController = new AbortController();
    setLoading(true);

    if (state.currentMode === 'god' && promptText.toLowerCase().startsWith('/create ')) {
        const subject = promptText.substring(8);
        promptText = `As a primordial deity, narrate the act of creation for the following subject, in the first person: "${subject}". Be majestic, creative, and descriptive.`;
    }

    const userMessage: ChatMessage = { id: `msg_${Date.now()}`, sender: 'user', text: promptText };
    if (state.uploadedImage) userMessage.imageUrl = `data:${state.uploadedImage.mimeType};base64,${state.uploadedImage.base64}`;
    
    addMessageToCurrentChat(userMessage);
    renderMessageToScreen(userMessage);
    
    DOMElements.promptInput.value = '';
    DOMElements.promptInput.style.height = 'auto';
    const tempImage = state.uploadedImage;
    const tempPdf = state.uploadedPdf;
    clearFilePreviews();

    try {
        const finalPrompt = tempPdf ? `--- PDF Content ---\n${tempPdf.text}\n\n--- User Prompt ---\n${promptText}` : promptText;
        
        if (promptText.startsWith('/image ')) {
            await generateImage(promptText.substring(7), state.abortController.signal);
        } else if (state.currentMode === 'web-search') {
            await handleGroundedSearch(finalPrompt);
        } else if (tempImage) {
            await generateMultimodalContent(promptText, tempImage);
        } else {
            await streamChatContent(finalPrompt, state.abortController.signal);
        }
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
             console.log("Generation stopped by user.");
        } else {
            const errorMessage = `An error occurred: ${error instanceof Error ? error.message : String(error)}`;
            const errorMsg: ChatMessage = { id: `msg_${Date.now()}`, sender: 'ai', text: errorMessage };
            addMessageToCurrentChat(errorMsg);
            renderMessageToScreen(errorMsg);
        }
    } finally {
        setLoading(false);
        state.abortController = null;
    }
}

async function streamChatContent(prompt: string, signal: AbortSignal) {
    if (!state.chat) return;

    const { messageEl, contentEl } = createStreamedMessageElement();
    let fullResponse = '';

    try {
        const responseStream = await state.chat.sendMessageStream({ message: prompt });
        for await (const chunk of responseStream) {
            if (signal.aborted) {
                fullResponse += '\n\n-- Generation stopped by user --';
                contentEl.innerHTML = marked.parse(fullResponse) as string;
                break;
            }
            fullResponse += chunk.text;
            contentEl.innerHTML = marked.parse(fullResponse) as string;
            DOMElements.chatMessages.parentElement!.scrollTop = DOMElements.chatMessages.parentElement!.scrollHeight;
        }

        if (signal.aborted) throw new Error('AbortError');

        let aiText = fullResponse;
        const imageCommandMatch = fullResponse.match(/\/image\s+(.*)/);
        if (state.currentMode === 'news' && imageCommandMatch) {
            aiText = fullResponse.replace(imageCommandMatch[0], '').trim();
            contentEl.innerHTML = marked.parse(aiText) as string;
            await generateImage(imageCommandMatch[1], signal);
        }

        addCopyButtonsToCodeBlocks(contentEl);
        addSpeakerButton(messageEl, aiText);
        addMessageToCurrentChat({ id: `msg_${Date.now()}`, sender: 'ai', text: aiText });
        updateChatTitleIfNeeded(prompt, aiText);

    } catch (error) {
        if (error instanceof Error && error.message === 'AbortError') throw error;
        const errorMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        contentEl.textContent = errorMessage;
        addMessageToCurrentChat({ id: `msg_${Date.now()}`, sender: 'ai', text: errorMessage });
    }
}

async function handleGroundedSearch(prompt: string) {
    if (!state.chat) return;
    const { messageEl, contentEl } = createStreamedMessageElement();

    try {
        const response = await state.chat.sendMessage({ message: prompt });
        const aiResponse = response.text;
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;

        contentEl.innerHTML = marked.parse(aiResponse) as string;
        if(groundingChunks) renderGroundingSources(contentEl, groundingChunks);
        
        addCopyButtonsToCodeBlocks(contentEl);
        addSpeakerButton(messageEl, aiResponse);
        addMessageToCurrentChat({ id: `msg_${Date.now()}`, sender: 'ai', text: aiResponse, groundingChunks });
        updateChatTitleIfNeeded(prompt, aiResponse);
    } catch (error) {
        const errorMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        contentEl.textContent = errorMessage;
        addMessageToCurrentChat({ id: `msg_${Date.now()}`, sender: 'ai', text: errorMessage });
    } finally {
        // Since this isn't streamed, we need to remove the thinking indicator from the streamed element
        const thinkingIndicator = DOMElements.chatMessages.querySelector('.thinking-indicator');
        if (thinkingIndicator) thinkingIndicator.remove();
    }
}


async function generateMultimodalContent(prompt: string, image: { base64: string, mimeType: string }) {
     if (!state.ai) return;
     const { messageEl, contentEl } = createStreamedMessageElement();
     
     const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
     const textPart = { text: prompt };

     try {
         const response = await state.ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts: [imagePart, textPart] } });
         contentEl.innerHTML = marked.parse(response.text) as string;
         addCopyButtonsToCodeBlocks(contentEl);
         addSpeakerButton(messageEl, response.text);
         addMessageToCurrentChat({ id: `msg_${Date.now()}`, sender: 'ai', text: response.text });
         updateChatTitleIfNeeded(prompt, response.text);
     } catch(error) {
         const errorMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
         contentEl.textContent = errorMessage;
         addMessageToCurrentChat({ id: `msg_${Date.now()}`, sender: 'ai', text: errorMessage });
     } finally {
        const thinkingIndicator = DOMElements.chatMessages.querySelector('.thinking-indicator');
        if (thinkingIndicator) thinkingIndicator.remove();
     }
}

async function generateImage(prompt: string, signal: AbortSignal) {
    if (!state.ai) return;
    const isChainedCall = DOMElements.chatMessages.querySelector('.thinking-indicator') !== null;
    let messageEl: HTMLDivElement, contentEl: HTMLDivElement;

    if (!isChainedCall) {
        ({ messageEl, contentEl } = createStreamedMessageElement());
        addMessageToCurrentChat({ id: `msg_${Date.now()}`, sender: 'user', text: `/image ${prompt}` });
        renderMessageToScreen({ id: `msg_${Date.now()}`, sender: 'user', text: `/image ${prompt}` });
    } else {
        contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        DOMElements.chatMessages.appendChild(contentEl);
        messageEl = contentEl.parentElement as HTMLDivElement;
    }

    try {
        if (signal.aborted) throw new Error('AbortError');
        const response = await state.ai.models.generateImages({
            model: 'imagen-3.0-generate-002',
            prompt: prompt,
            config: { numberOfImages: 1, outputMimeType: 'image/jpeg', aspectRatio: '1:1' }
        });
        
        if (signal.aborted) throw new Error('AbortError');

        if (response.generatedImages && response.generatedImages.length > 0) {
            const base64Image = response.generatedImages[0].image.imageBytes;
            const imageUrl = `data:image/jpeg;base64,${base64Image}`;
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = prompt;
            contentEl.innerHTML = '';
            contentEl.appendChild(img);
            
            addMessageToCurrentChat({ id: `msg_${Date.now()}`, sender: 'ai', text: `Image for: ${prompt}`, imageUrl: imageUrl });
        } else {
             const noImageText = "Sorry, I couldn't generate an image for that.";
             contentEl.textContent = noImageText;
             addMessageToCurrentChat({ id: `msg_${Date.now()}`, sender: 'ai', text: noImageText });
        }
    } catch (error) {
        if (error instanceof Error && error.message === 'AbortError') throw error;
        const errorMessage = `Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        contentEl.textContent = errorMessage;
        addMessageToCurrentChat({ id: `msg_${Date.now()}`, sender: 'ai', text: errorMessage });
    } finally {
        if (isChainedCall) {
            DOMElements.chatMessages.parentElement!.scrollTop = DOMElements.chatMessages.parentElement!.scrollHeight;
        }
        const thinkingIndicator = DOMElements.chatMessages.querySelector('.thinking-indicator');
        if (thinkingIndicator) thinkingIndicator.remove();
    }
}


function setupEventListeners() {
    DOMElements.chatForm.addEventListener('submit', handleSendMessage);
    DOMElements.stopBtn.addEventListener('click', () => state.abortController?.abort());
    DOMElements.promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
    });
    DOMElements.promptInput.addEventListener('input', () => {
        const el = DOMElements.promptInput;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    });
    
    DOMElements.imageUploadBtn.addEventListener('click', () => DOMElements.imageUploadInput.click());
    DOMElements.imageUploadInput.addEventListener('change', handleImageUpload);
    DOMElements.pdfUploadBtn.addEventListener('click', () => DOMElements.pdfUploadInput.click());
    DOMElements.pdfUploadInput.addEventListener('change', handlePdfUpload);

    DOMElements.modeSelect.addEventListener('change', (e) => {
        const newMode = (e.target as HTMLSelectElement).value;
        if (newMode !== state.currentMode) {
            if (newMode === 'custom') {
                startNewChat('custom');
            } else {
                startNewChat(newMode);
            }
        }
    });
    
    DOMElements.savePersonaBtn.addEventListener('click', () => {
        const personaText = DOMElements.customPersonaInput.value.trim();
        if (personaText) {
            localStorage.setItem('zurk-custom-persona', personaText);
            startNewChat('custom', personaText);
            DOMElements.savePersonaBtn.textContent = 'Started!';
            setTimeout(() => { DOMElements.savePersonaBtn.textContent = 'Save & Start'; }, 2000);
        }
    });

    DOMElements.themeSelect.addEventListener('change', (e) => { document.body.dataset.theme = (e.target as HTMLSelectElement).value; });
    DOMElements.newChatBtn.addEventListener('click', () => {
        const currentChat = getChatHistory().find(c => c.id === state.activeChatId);
        if (currentChat && currentChat.messages.length > 0) {
            if (confirm("Are you sure? Your current chat will be saved in the history.")) {
                startNewChat(state.currentMode);
            }
        } else {
            startNewChat(state.currentMode);
        }
    });
    DOMElements.exportChatBtn.addEventListener('click', exportCurrentChat);
    DOMElements.fullscreenBtn.addEventListener('click', toggleFullScreen);
    
    // Sidebar toggle logic
    DOMElements.toggleSidebarBtn.addEventListener('click', closeSidebar);
    DOMElements.openSidebarBtn.addEventListener('click', openSidebar);
    DOMElements.sidebarOverlay.addEventListener('click', closeSidebar);
    
    DOMElements.voiceRate.addEventListener('input', () => DOMElements.rateValue.textContent = DOMElements.voiceRate.value);
    DOMElements.voicePitch.addEventListener('input', () => DOMElements.pitchValue.textContent = DOMElements.voicePitch.value);
    
    if (recognition) {
        DOMElements.voiceInputBtn.addEventListener('click', toggleVoiceRecognition);
        recognition.onresult = (event: any) => { DOMElements.promptInput.value = event.results[0][0].transcript; };
        recognition.onerror = (event: any) => { console.error('Speech recognition error:', event.error); };
        recognition.onend = () => DOMElements.voiceInputBtn.classList.remove('recording');
    } else {
        DOMElements.voiceInputBtn.style.display = 'none';
    }

    document.addEventListener('keydown', handleKeyboardShortcuts);
    document.addEventListener('fullscreenchange', syncFullscreenButton);

    // Drag and Drop
    DOMElements.mainContent.addEventListener('dragenter', handleDragEnter);
    DOMElements.dragDropOverlay.addEventListener('dragleave', handleDragLeave);
    DOMElements.dragDropOverlay.addEventListener('dragover', handleDragOver);
    DOMElements.dragDropOverlay.addEventListener('drop', handleDrop);
}

// --- UI & RENDER FUNCTIONS ---

function renderWelcomeMessage(mode: string) {
    const messages: { [key: string]: string } = {
        zurk: "Welcome to ZurkAI. How can I redefine your reality today?",
        god: "The universe holds its breath. Speak.",
        coder: "Code Assistant initialized. Provide a task, and I shall build.",
        thinker: "The stage is set for intellectual discourse. What shall we ponder?",
        news: "News Desk online. What is your query on current events?",
        fitness: "Fitness protocol engaged. State your goals.",
        study: "Study session initiated. What subject shall we conquer?",
        creative: "The canvas is blank, the possibilities infinite. What shall we create?",
        simulator: "Simulation core online. Describe the reality you wish to experience.",
        emotional: "I am here to listen. How are you feeling?",
        'zurk-developer': "ZurkAI Developer console active. Report a bug or request a feature.",
        'custom': "Custom persona activated. How may I assist you?",
        default: "ZurkAI initialized. What is your query?"
    };

    const hint = `<p class="shortcut-hint">Pro-tip: Use Cmd/Ctrl+K for a new chat or Cmd/Ctrl+J to toggle the sidebar.</p>`;
    const welcomeText = (messages[mode] || messages.default);
    
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'message ai-message welcome-message';
    messageWrapper.innerHTML = `<div class="message-content"><p>${welcomeText}</p>${hint}</div>`;
    DOMElements.chatMessages.appendChild(messageWrapper);
}

function renderMessageToScreen(message: ChatMessage) {
    const messageWrapper = document.createElement('div');
    messageWrapper.id = message.id;
    messageWrapper.className = `message ${message.sender}-message`;
    
    if (state.currentMode === 'god' && message.sender === 'user') {
        messageWrapper.classList.add('ascend');
    }

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';

    if (message.text) {
        if (message.sender === 'ai') {
            messageContent.innerHTML = marked.parse(message.text) as string;
            if (message.groundingChunks) {
                renderGroundingSources(messageContent, message.groundingChunks);
            }
            addCopyButtonsToCodeBlocks(messageContent);
            addSpeakerButton(messageWrapper, message.text);
        } else {
            const p = document.createElement('p');
            p.textContent = message.text;
            messageContent.appendChild(p);
            addEditButton(messageWrapper, message);
        }
    }

    if (message.imageUrl) {
        const img = document.createElement('img');
        img.src = message.imageUrl;
        img.alt = message.text || 'Uploaded image';
        messageContent.appendChild(img);
    }
    
    messageWrapper.appendChild(messageContent);
    DOMElements.chatMessages.appendChild(messageWrapper);
    DOMElements.chatMessages.parentElement!.scrollTop = DOMElements.chatMessages.parentElement!.scrollHeight;
}

function renderGroundingSources(container: HTMLElement, chunks: any[]) {
    const sources = chunks
        .map(chunk => chunk.web)
        .filter(web => web?.uri)
        .filter((value, index, self) => self.findIndex(v => v.uri === value.uri) === index); // Unique URIs

    if (sources.length > 0) {
        const sourcesDiv = document.createElement('div');
        sourcesDiv.className = 'grounding-sources';
        sourcesDiv.innerHTML = '<h4>Sources:</h4>';
        const ol = document.createElement('ol');
        sources.forEach(source => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = source.uri;
            a.textContent = source.title || source.uri;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            li.appendChild(a);
            ol.appendChild(li);
        });
        sourcesDiv.appendChild(ol);
        container.appendChild(sourcesDiv);
    }
}


function createStreamedMessageElement() {
    const thinkingEl = document.createElement('div');
    thinkingEl.className = 'thinking-indicator';
    thinkingEl.textContent = 'Thinking...';
    DOMElements.chatMessages.appendChild(thinkingEl);

    const messageId = `msg_${Date.now()}`;
    const messageEl = document.createElement('div');
    messageEl.id = messageId;
    messageEl.className = 'message ai-message';
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';

    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.innerHTML = `<span></span><span></span><span></span>`;
    
    const godLoader = document.createElement('div');
    godLoader.className = 'god-mode-loader';
    godLoader.innerHTML = `<div class="eye"></div>`;

    contentEl.appendChild(loadingIndicator);
    contentEl.appendChild(godLoader);
    
    messageEl.appendChild(contentEl);
    DOMElements.chatMessages.appendChild(messageEl);
    DOMElements.chatMessages.parentElement!.scrollTop = DOMElements.chatMessages.parentElement!.scrollHeight;
    
    thinkingEl.remove();

    return { messageEl, contentEl };
}

function addSpeakerButton(messageEl: HTMLElement, textToSpeak: string) {
    const contentDiv = messageEl.querySelector('.message-content');
    if (!contentDiv || !textToSpeak.trim()) return;
    const speakerBtn = document.createElement('button');
    speakerBtn.className = 'icon-btn speaker-btn';
    speakerBtn.innerHTML = '<i class="ph ph-speaker-high"></i>';
    speakerBtn.ariaLabel = 'Read aloud';
    speakerBtn.onclick = () => toggleSpeech(textToSpeak, speakerBtn);
    contentDiv.appendChild(speakerBtn);
}

function addCopyButtonsToCodeBlocks(contentEl: HTMLElement) {
    const codeBlocks = contentEl.querySelectorAll('pre');
    codeBlocks.forEach(pre => {
        const copyBtnFragment = DOMElements.copyBtnTemplate.content.cloneNode(true) as DocumentFragment;
        const copyBtn = copyBtnFragment.querySelector('.copy-btn') as HTMLButtonElement;
        
        copyBtn.addEventListener('click', () => {
            const codeToCopy = pre.querySelector('code')?.innerText || '';
            navigator.clipboard.writeText(codeToCopy).then(() => {
                copyBtn.innerHTML = '<i class="ph ph-check"></i> <span>Copied!</span>';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="ph ph-copy"></i> <span>Copy</span>';
                    copyBtn.classList.remove('copied');
                }, 2000);
            });
        });

        pre.appendChild(copyBtn);
    });
}

function addEditButton(messageEl: HTMLElement, message: ChatMessage) {
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn edit-btn';
    editBtn.title = 'Edit and resubmit';
    editBtn.innerHTML = '<i class="ph ph-pencil-simple"></i>';
    editBtn.onclick = () => handleEdit(message, messageEl);
    messageEl.appendChild(editBtn);
}


function handleEdit(message: ChatMessage, messageEl: HTMLElement) {
    const allChats = getChatHistory();
    const currentChat = allChats.find(c => c.id === state.activeChatId);
    if (!currentChat) return;

    const messageIndex = currentChat.messages.findIndex(m => m.id === message.id);
    if (messageIndex === -1) return;

    const forkedMessages = currentChat.messages.slice(0, messageIndex);
    startNewChat(currentChat.mode, currentChat.customPersona, forkedMessages, `${currentChat.title} (edited)`);
    
    setTimeout(() => {
        DOMElements.promptInput.value = message.text;
        DOMElements.promptInput.focus();
        DOMElements.promptInput.style.height = 'auto';
        DOMElements.promptInput.style.height = `${DOMElements.promptInput.scrollHeight}px`;
    }, 0);
}


function loadChat(chatId: string) {
    const allChats = getChatHistory();
    const chatToLoad = allChats.find(c => c.id === chatId);

    if (!chatToLoad || !state.ai) return;

    state.activeChatId = chatId;
    localStorage.setItem('zurk-active-chat-id', chatId);
    state.currentMode = chatToLoad.mode;
    state.uploadedPdf = chatToLoad.pdfText ? { text: chatToLoad.pdfText, name: 'Loaded PDF' } : null;
    
    let chatConfig: { systemInstruction?: string; tools?: any[] } = {};
    if (chatToLoad.mode === 'custom') {
        chatConfig.systemInstruction = chatToLoad.customPersona || "You are a helpful, customizable AI assistant.";
    } else if (chatToLoad.mode === 'web-search') {
        chatConfig.tools = [{ googleSearch: {} }];
    } else {
        chatConfig.systemInstruction = SYSTEM_INSTRUCTIONS[chatToLoad.mode];
    }
    
    const historyForGenAI: Content[] = chatToLoad.messages
        .filter(m => m.text) // Filter out image-only messages for history
        .map(m => ({
            role: m.sender === 'user' ? 'user' : 'model',
            parts: [{ text: (m.sender === 'user' && chatToLoad.pdfText)
                ? `--- PDF Content ---\n${chatToLoad.pdfText}\n\n--- User Prompt ---\n${m.text}`
                : m.text }]
        }));

    state.chat = state.ai.chats.create({
        model: 'gemini-2.5-flash',
        config: chatConfig,
        history: historyForGenAI
    });

    DOMElements.chatMessages.innerHTML = '';
    if (chatToLoad.messages.length === 0) {
        renderWelcomeMessage(chatToLoad.mode);
    } else {
        chatToLoad.messages.forEach(renderMessageToScreen);
    }
    
    DOMElements.modeSelect.value = chatToLoad.mode;
    if (chatToLoad.mode === 'custom') {
        DOMElements.customPersonaInput.value = chatToLoad.customPersona || '';
    }
    
    applyModeSpecificUI(chatToLoad.mode);
    toggleCustomPersonaView();
    renderChatHistory();
    DOMElements.promptInput.focus();
}

function renderChatHistory() {
    const allChats = getChatHistory();
    DOMElements.chatHistoryList.innerHTML = '';
    allChats.forEach(chat => {
        const li = document.createElement('li');
        li.className = 'chat-history-item';
        li.textContent = chat.title;
        li.dataset.chatId = chat.id;
        li.onclick = () => {
            loadChat(chat.id);
            if (window.innerWidth <= 768) closeSidebar();
        };
        if (chat.id === state.activeChatId) {
            li.classList.add('active');
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-chat-btn';
        deleteBtn.innerHTML = '<i class="ph ph-trash"></i>';
        deleteBtn.ariaLabel = 'Delete chat';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteChat(chat.id);
        };
        li.appendChild(deleteBtn);
        DOMElements.chatHistoryList.appendChild(li);
    });
}

function deleteChat(chatId: string) {
    if (confirm("Are you sure you want to permanently delete this chat?")) {
        let allChats = getChatHistory();
        const newHistory = allChats.filter(c => c.id !== chatId);
        saveChatHistory(newHistory);
        
        if (state.activeChatId === chatId) {
            if (newHistory.length > 0) {
                loadChat(newHistory[0].id);
            } else {
                startNewChat();
            }
        }
        renderChatHistory();
    }
}

// --- HELPERS & UTILS ---

function applyModeSpecificUI(mode: string) {
    const isGodMode = mode === 'god';
    const isNewsMode = mode === 'news';
    
    DOMElements.themeSelect.disabled = false;
    godCanvas.destroy();
    DOMElements.logoIcon.className = 'ph ph-brain';
    document.body.dataset.theme = DOMElements.themeSelect.value;

    if (isGodMode) {
        document.body.dataset.theme = 'god-tier';
        DOMElements.themeSelect.disabled = true;
        DOMElements.logoIcon.className = 'ph ph-crown';
        godCanvas.init();
    } else if (isNewsMode) {
        document.body.dataset.theme = 'news-theme';
        DOMElements.logoIcon.className = 'ph ph-newspaper';
    }
}


function addMessageToCurrentChat(message: ChatMessage) {
    if (!state.activeChatId) return;
    const allChats = getChatHistory();
    const chat = allChats.find(c => c.id === state.activeChatId);
    if (chat) {
        chat.messages.push(message);
        updateCurrentChat({ messages: chat.messages });
    }
}

async function updateChatTitleIfNeeded(prompt: string, response: string) {
    if (!state.activeChatId) return;
    const allChats = getChatHistory();
    const chat = allChats.find(c => c.id === state.activeChatId);
    if (chat && chat.title === 'New Chat') {
        const titlePrompt = `Summarize this conversation into a short, 4-word or less title. Do not use quotes.
User: ${prompt.substring(0, 100)}
AI: ${response.substring(0, 100)}`;

        const titleResponse = await state.ai!.models.generateContent({
             model: 'gemini-2.5-flash',
             contents: titlePrompt
        });
        const newTitle = titleResponse.text.trim().replace(/"/g, '');
        updateCurrentChat({ title: newTitle });
        renderChatHistory();
    }
}

function handleKeyboardShortcuts(e: KeyboardEvent) {
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        DOMElements.newChatBtn.click();
    }
    if (e.key === 'j' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        DOMElements.sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    }
     if (e.key === 'Escape') {
        if (state.isLoading) {
            state.abortController?.abort();
        } else {
            DOMElements.promptInput.value = '';
        }
    }
}

function handleImageUpload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    processFile(file);
}

async function handlePdfUpload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || file.type !== 'application/pdf') return;
    processFile(file);
}

function processFile(file: File) {
    clearFilePreviews();
    
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = (reader.result as string).split(',')[1];
            state.uploadedImage = { base64: base64String, mimeType: file.type };
            renderFilePreview(file.name, reader.result as string);
        };
        reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf') {
        DOMElements.pdfUploadBtn.classList.add('loading');
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target!.result as ArrayBuffer;
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    fullText += textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
                }
                state.uploadedPdf = { text: fullText, name: file.name };
                updateCurrentChat({ pdfText: fullText });
                renderFilePreview(file.name);
            } catch (error) {
                 console.error("PDF processing error:", error);
                 renderMessageToScreen({ id:`msg_${Date.now()}`, sender: 'ai', text: `Error processing PDF: ${error instanceof Error ? error.message : 'Unknown error'}`});
            } finally {
                DOMElements.pdfUploadBtn.classList.remove('loading');
            }
        };
        reader.readAsArrayBuffer(file);
    }
}

function renderFilePreview(name: string, src?: string) {
    const previewWrapper = document.createElement('div');
    previewWrapper.className = 'file-preview';

    if (src) {
        previewWrapper.innerHTML = `
            <img id="image-preview" src="${src}" alt="Image preview"/>
            <button class="icon-btn remove-file-btn"><i class="ph ph-x"></i></button>`;
    } else {
        previewWrapper.classList.add('pdf-preview');
        previewWrapper.innerHTML = `
            <i class="ph ph-file-pdf"></i>
            <span>${name}</span>
            <button class="icon-btn remove-file-btn"><i class="ph ph-x"></i></button>`;
    }
    previewWrapper.querySelector('.remove-file-btn')!.addEventListener('click', clearFilePreviews);
    DOMElements.filePreviewContainer.appendChild(previewWrapper);
    DOMElements.promptInput.focus();
}

function clearFilePreviews() {
    state.uploadedImage = null;
    state.uploadedPdf = null;
    DOMElements.imageUploadInput.value = '';
    DOMElements.pdfUploadInput.value = '';
    DOMElements.filePreviewContainer.innerHTML = '';
    if(state.activeChatId) updateCurrentChat({ pdfText: undefined });
}

function loadChatHistory() {
    state.activeChatId = localStorage.getItem('zurk-active-chat-id');
    renderChatHistory();
}

function toggleCustomPersonaView() {
    DOMElements.customPersonaGroup.style.display = state.currentMode === 'custom' ? 'flex' : 'none';
}

function setLoading(isLoading: boolean) {
    state.isLoading = isLoading;
    DOMElements.chatForm.classList.toggle('loading', isLoading);
    DOMElements.promptInput.toggleAttribute('disabled', isLoading);
}

function openSidebar() {
    DOMElements.sidebar.classList.add('open');
    if (window.innerWidth <= 768) {
        DOMElements.sidebarOverlay.classList.add('visible');
    }
}

function closeSidebar() {
    DOMElements.sidebar.classList.remove('open');
    if (window.innerWidth <= 768) {
        DOMElements.sidebarOverlay.classList.remove('visible');
    }
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
        document.exitFullscreen();
    }
}

function syncFullscreenButton() {
    if (document.fullscreenElement) {
        DOMElements.fullscreenBtn.innerHTML = '<i class="ph ph-arrows-in"></i> Exit Fullscreen';
    } else {
        DOMElements.fullscreenBtn.innerHTML = '<i class="ph ph-arrows-out"></i> Fullscreen';
    }
}

function populateVoiceList() {
    voices = synth.getVoices();
    DOMElements.voiceSelect.innerHTML = '';
    voices.forEach(voice => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})`;
        option.setAttribute('data-lang', voice.lang);
        option.setAttribute('data-name', voice.name);
        DOMElements.voiceSelect.appendChild(option);
    });
}

function toggleSpeech(text: string, btn: HTMLButtonElement) {
    const icon = btn.querySelector('i');
    if (!icon) return;

    const isCurrentlySpeakingThis = synth.speaking && currentlySpeakingButton === btn;

    if (synth.speaking) {
        synth.cancel();
    }

    if (isCurrentlySpeakingThis) {
        return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    if (state.currentMode === 'god') {
        const preferredVoices = [
            'Microsoft David - English (United States)', 'Google US English', 'Alex',
        ];
        let godVoice: SpeechSynthesisVoice | undefined;
        for (const name of preferredVoices) {
            godVoice = voices.find(v => v.name === name);
            if (godVoice) break;
        }
        if (!godVoice) godVoice = voices.find(v => v.lang.startsWith('en-') && v.name.toLowerCase().includes('male'));
        
        utterance.voice = godVoice || voices.find(v => v.lang.startsWith('en-')) || null;
        utterance.pitch = 0.7;
        utterance.rate = 0.85;
    } else {
        const selectedVoiceName = DOMElements.voiceSelect.selectedOptions[0]?.getAttribute('data-name');
        utterance.voice = voices.find(v => v.name === selectedVoiceName) || null;
        utterance.pitch = parseFloat(DOMElements.voicePitch.value);
        utterance.rate = parseFloat(DOMElements.voiceRate.value);
    }
    
    utterance.onstart = () => {
        if (currentlySpeakingButton && currentlySpeakingButton !== btn) {
            const oldIcon = currentlySpeakingButton.querySelector('i');
            if (oldIcon) oldIcon.className = 'ph ph-speaker-high';
        }
        currentlySpeakingButton = btn;
        icon.className = 'ph ph-stop-circle';
    };

    const cleanup = () => {
        if (currentlySpeakingButton === btn) {
            icon.className = 'ph ph-speaker-high';
            currentlySpeakingButton = null;
        }
    };
    
    utterance.onend = cleanup;
    utterance.onerror = (e) => {
        if (e.error !== 'interrupted') console.error("Speech synthesis error:", e.error);
        cleanup();
    };

    synth.speak(utterance);
}


function toggleVoiceRecognition() {
    if(!recognition) return;
    if (DOMElements.voiceInputBtn.classList.contains('recording')) {
        recognition.stop();
    } else {
        recognition.start();
        DOMElements.voiceInputBtn.classList.add('recording');
    }
}

function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    DOMElements.dragDropOverlay.classList.add('visible');
}
function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    DOMElements.dragDropOverlay.classList.remove('visible');
}
function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
}
function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    DOMElements.dragDropOverlay.classList.remove('visible');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
        processFile(files[0]);
    }
}

function exportCurrentChat() {
    const currentChat = getChatHistory().find(c => c.id === state.activeChatId);
    if (!currentChat) return;

    let markdownContent = `# Chat: ${currentChat.title}\n\n**Mode:** ${currentChat.mode}\n\n---\n\n`;

    currentChat.messages.forEach(msg => {
        const sender = msg.sender === 'ai' ? 'ZurkAI' : 'User';
        markdownContent += `### **${sender}**\n\n`;
        if (msg.imageUrl) {
            markdownContent += `![Image](${msg.imageUrl})\n\n`;
        }
        if (msg.text) {
            markdownContent += `${msg.text}\n\n`;
        }
        markdownContent += `---\n\n`;
    });

    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentChat.title.replace(/ /g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- START THE APP ---
init();

}); // End of DOMContentLoaded