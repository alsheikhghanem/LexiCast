export class TextProcessor {
    constructor() {
        this.wordElementsCount = 0;
        this.spokenWordsList = [];
        this.spokenToSpanMap = [];
    }

    isArabicText(text) {
        return /[\u0600-\u06FF]/.test(text);
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
                return `<span class="dual-word text-blue-800 bg-blue-50 px-1 border border-blue-200 rounded font-bold transition-all duration-75 ease-in-out inline-block" data-phonetic="${data.phonetic}">${data.visual}</span>`;
            }
            return match;
        });

        displayElement.innerHTML = htmlContent;
        const isRTL = this.isArabicText(sanitizedText);
        displayElement.setAttribute("dir", isRTL ? "rtl" : "ltr");
        displayElement.className = `w-full border border-gray-200 rounded-lg p-6 bg-white prose max-w-none min-h-[250px] max-h-[500px] overflow-y-auto shadow-inner text-gray-800 leading-relaxed transition-all scroll-smooth relative ${isRTL ? 'text-right' : 'text-left'}`;
    }

    buildMemoryMapAndDOM(displayElement) {
        this.wordElementsCount = 0;
        this.spokenWordsList = [];
        this.spokenToSpanMap = [];

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
                    this.spokenWordsList.push(pw);
                    this.spokenToSpanMap.push(spanId);
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
                        span.className = "transition-all duration-75 ease-in-out px-1 rounded inline-block text-gray-800";
                        span.setAttribute('data-original-class', span.className);
                        span.textContent = word;
                        fragment.appendChild(span);

                        this.spokenWordsList.push(word.trim());
                        this.spokenToSpanMap.push(spanId);
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
        return this.spokenWordsList.join(" ").replace(/\s+/g, ' ').trim();
    }
}