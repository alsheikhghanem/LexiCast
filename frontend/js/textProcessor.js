export class TextProcessor {
    constructor() {
        this.wordElementsCount = 0;
        this.chunks = [];
    }

    sanitizeInput(text) {
        return text.replace(/`\{\{\s*(.*?)\s*(?:\||::)\s*(.*?)\s*}}`/g, '{{$1::$2}}');
    }

    renderLivePreview(rawText, displayElement) {
        const sanitizedText = this.sanitizeInput(rawText);
        let dictionary = {};
        let counter = 0;

        let preProcessedText = sanitizedText.replace(/\{\{\s*(.*?)\s*(?:\||::)\s*(.*?)\s*}}/g, function (match, visual, phonetic) {
            let token = '@@DUAL_' + counter++ + '@@';
            dictionary[token] = {visual: visual.trim(), phonetic: phonetic.trim()};
            return token;
        });

        const markedParser = window['marked'];
        let htmlContent = markedParser.parse(preProcessedText);

        htmlContent = htmlContent.replace(/@@DUAL_\d+@@/g, function (match) {
            let data = dictionary[match];
            if (data) {
                return `<span class="dual-word font-bold transition-all duration-75 ease-in-out inline-block" data-phonetic="${data.phonetic}">${data.visual}</span>`;
            }
            return match;
        });

        displayElement.innerHTML = htmlContent;

        const blockElements = displayElement.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote');
        blockElements.forEach(el => el.setAttribute('dir', 'auto'));
    }

    buildMemoryMapAndDOM(displayElement) {
        this.wordElementsCount = 0;
        this.chunks = [];
        let currentChunk = {words: [], spanIds: [], text: ""};

        const flushChunk = () => {
            if (currentChunk.words.length > 0) {
                currentChunk.text = currentChunk.words.join(" ").replace(/\s+/g, ' ').trim();
                this.chunks.push(currentChunk);
                currentChunk = {words: [], spanIds: [], text: ""};
            }
        };

        const walk = (node) => {
            if (node.nodeType === Node.ELEMENT_NODE && (node.tagName.toUpperCase() === 'PRE' || node.tagName.toUpperCase() === 'TABLE')) {
                return;
            }

            if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('dual-word')) {
                const spanId = `md-word-${this.wordElementsCount++}`;
                node.id = spanId;
                node.setAttribute('data-original-class', node.className);

                const phoneticText = node.getAttribute('data-phonetic');
                const phoneticWords = phoneticText.split(/\s+/).filter(w => w.trim().length > 0);

                phoneticWords.forEach(pw => {
                    currentChunk.words.push(pw);
                    currentChunk.spanIds.push(spanId);
                    const isSentenceEnd = /[.!?؟\n\r]/.test(pw);
                    if (isSentenceEnd || currentChunk.words.length >= 40) flushChunk();
                });
                return;
            }

            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.nodeValue;
                const words = text.split(/(\s+)/);
                if (words.length <= 1 && text.trim() === '') return;

                const fragment = document.createDocumentFragment();
                words.forEach(word => {
                    if (word.trim().length > 0) {
                        const spanId = `md-word-${this.wordElementsCount++}`;
                        const span = document.createElement('span');
                        span.id = spanId;
                        span.className = "transition-all duration-75 ease-in-out rounded inline-block relative";
                        span.setAttribute('data-original-class', span.className);
                        span.textContent = word;
                        fragment.appendChild(span);

                        currentChunk.words.push(word.trim());
                        currentChunk.spanIds.push(spanId);

                        const isSentenceEnd = /[.!?؟\n\r]/.test(word);
                        if (isSentenceEnd || currentChunk.words.length >= 40) {
                            flushChunk();
                        }
                    } else {
                        fragment.appendChild(document.createTextNode(word));
                    }
                });
                node.parentNode.replaceChild(fragment, node);
            } else if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE'].includes(node.nodeName)) {
                Array.from(node.childNodes).forEach(walk);
            }
        };

        Array.from(displayElement.childNodes).forEach(walk);
        flushChunk();

        return this.chunks.filter(c => c.text.trim().length > 0 && /[a-zA-Z\u0600-\u06FF0-9]/.test(c.text));
    }
}