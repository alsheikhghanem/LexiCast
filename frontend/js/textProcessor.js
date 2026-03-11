export class TextProcessor {
    constructor() {
        this.wordElementsCount = 0;
        this.chunks = [];
    }

    sanitizeInput(text) {
        return text.replace(/`\{\{\s*(.*?)\s*(?:\||::)\s*(.*?)\s*}}`/g, '{{$1::$2}}');
    }

    renderLivePreview(rawText, displayElement) {
        let dictionary = {};
        let counter = 0;

        // M-07: Protect code blocks FIRST — before any text processing
        let codeBlocks = {};
        let codeCounter = 0;
        let protectedRaw = rawText.replace(/```[\s\S]*?```/g, function (match) {
            let token = '@@CODE_BLOCK_' + codeCounter++ + '@@';
            codeBlocks[token] = match;
            return token;
        });
        protectedRaw = protectedRaw.replace(/`[^`\n]+`/g, function (match) {
            let token = '@@CODE_BLOCK_' + codeCounter++ + '@@';
            codeBlocks[token] = match;
            return token;
        });

        const sanitizedText = this.sanitizeInput(protectedRaw);

        let preProcessedText = sanitizedText.replace(/\{\{\s*(.*?)\s*(?:\||::)\s*(.*?)\s*}}/g, function (match, visual, phonetic) {
            let token = '@@DUAL_' + counter++ + '@@';
            dictionary[token] = {visual: visual.trim(), phonetic: phonetic.trim()};
            return token;
        });

        // Restore code blocks before markdown parsing
        for (let token in codeBlocks) {
            preProcessedText = preProcessedText.replace(token, codeBlocks[token]);
        }

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

    // M-09: Semantic chunking — checks if current position is a good break point
    _isSemanticBreak(word, nextWord, chunkLen) {
        const SOFT_LIMIT = 30;
        const HARD_LIMIT = 80;
        const isSentenceEnd = /[.!?؟]$/.test(word);
        if (isSentenceEnd) return true;
        if (chunkLen >= HARD_LIMIT) return true;
        if (chunkLen >= SOFT_LIMIT) {
            // Break at semicolons, colons, or line breaks
            if (/[;؛:\n\r]$/.test(word)) return true;
            // Break at commas when followed by a conjunction
            if (/[,،]$/.test(word) && nextWord) {
                const CONJUNCTIONS = /^(و|ف|ثم|أو|لكن|بل|حتى|إذا|لأن|and|or|but|however|then|because|so|yet|although|while)$/i;
                if (CONJUNCTIONS.test(nextWord.trim())) return true;
            }
            // Break before Arabic prefixed conjunctions (و، فـ)
            const trimmedNext = nextWord ? nextWord.trim() : '';
            if (trimmedNext && /^[وف]/.test(trimmedNext) && trimmedNext.length > 1) return true;
        }
        return false;
    }

    // M-10: JIT Rendering — build memory map without creating <span> elements
    buildMemoryMapAndDOM(displayElement) {
        this.wordElementsCount = 0;
        this.chunks = [];
        this.displayElement = displayElement;
        this._paragraphCounter = 0;
        this._activeChunkIndices = new Set();

        let currentChunk = {words: [], spanIds: [], text: "", wordEntries: []};

        const flushChunk = () => {
            if (currentChunk.words.length > 0) {
                currentChunk.text = currentChunk.words.join(" ").replace(/\s+/g, ' ').trim();
                // Pre-allocate spanIds array matching words length (populated during activation)
                currentChunk.spanIds = new Array(currentChunk.words.length).fill(null);
                this.chunks.push(currentChunk);
                currentChunk = {words: [], spanIds: [], text: "", wordEntries: []};
            }
        };

        const addWord = (word, entry) => {
            currentChunk.words.push(word);
            currentChunk.wordEntries.push(entry);
        };

        const walk = (node) => {
            if (node.nodeType === Node.ELEMENT_NODE && (node.tagName.toUpperCase() === 'PRE' || node.tagName.toUpperCase() === 'TABLE')) {
                return;
            }

            if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('dual-word')) {
                const globalIdx = this.wordElementsCount++;
                node.id = `md-word-${globalIdx}`;
                node.setAttribute('data-original-class', node.className);

                const phoneticText = node.getAttribute('data-phonetic');
                const phoneticWords = phoneticText.split(/\s+/).filter(w => w.trim().length > 0);

                phoneticWords.forEach((pw, pi) => {
                    addWord(pw, {type: 'dual', elementId: node.id, globalIdx});
                    const nextPw = phoneticWords[pi + 1] || null;
                    if (this._isSemanticBreak(pw, nextPw, currentChunk.words.length)) flushChunk();
                });
                return;
            }

            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.nodeValue;
                if (!text || text.trim() === '') return;

                // Find nearest block parent and tag it for JIT activation
                let blockParent = node.parentNode;
                while (blockParent && blockParent !== displayElement) {
                    const tag = blockParent.tagName;
                    if (tag && /^(P|H[1-6]|LI|BLOCKQUOTE|DIV)$/i.test(tag)) break;
                    blockParent = blockParent.parentNode;
                }
                if (!blockParent || blockParent === displayElement) blockParent = node.parentNode;

                if (!blockParent.dataset.paragraphId) {
                    blockParent.dataset.paragraphId = String(this._paragraphCounter++);
                }
                const paragraphId = blockParent.dataset.paragraphId;

                const rawWords = text.split(/\s+/).filter(w => w.length > 0);
                rawWords.forEach((word, wi) => {
                    const globalIdx = this.wordElementsCount++;
                    addWord(word.trim(), {
                        type: 'text',
                        paragraphId,
                        globalIdx
                    });
                    const nextWord = rawWords[wi + 1] || null;
                    if (this._isSemanticBreak(word, nextWord, currentChunk.words.length)) flushChunk();
                });
            } else if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE'].includes(node.nodeName)) {
                Array.from(node.childNodes).forEach(walk);
            }
        };

        Array.from(displayElement.childNodes).forEach(walk);
        flushChunk();

        this.chunks = this.chunks.filter(c => c.text.trim().length > 0 && /[a-zA-Z\u0600-\u06FF0-9]/.test(c.text));
        return this.chunks;
    }

    // M-10: Activate a chunk — wrap only its words in <span> for highlighting
    activateChunk(chunkIndex) {
        if (chunkIndex < 0 || chunkIndex >= this.chunks.length) return;
        if (this._activeChunkIndices.has(chunkIndex)) return;
        this._activeChunkIndices.add(chunkIndex);

        const chunk = this.chunks[chunkIndex];
        const spanIds = [];

        // Collect which paragraphs need activation and their word indices
        const paragraphWords = new Map(); // paragraphId -> [{entryIdx, globalIdx}]
        chunk.wordEntries.forEach((entry, idx) => {
            if (entry.type === 'dual') {
                // Dual-word spans already exist in DOM — just record the spanId
                spanIds[idx] = entry.elementId;
            } else {
                spanIds[idx] = null; // Will be populated below
                if (!paragraphWords.has(entry.paragraphId)) {
                    paragraphWords.set(entry.paragraphId, []);
                }
                paragraphWords.get(entry.paragraphId).push({entryIdx: idx, globalIdx: entry.globalIdx});
            }
        });

        // For each paragraph, wrap its text words in spans
        paragraphWords.forEach((wordsInPara, paragraphId) => {
            const blockEl = this.displayElement.querySelector(`[data-paragraph-id="${paragraphId}"]`);
            if (!blockEl) return;

            // Collect all globalIdx values that need spans in this paragraph (from ALL active chunks)
            const neededGlobalIdxSet = new Set(wordsInPara.map(w => w.globalIdx));

            // Walk text nodes and wrap matching words
            const textNodes = [];
            const collectTextNodes = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    textNodes.push(node);
                } else if (node.nodeType === Node.ELEMENT_NODE &&
                           !node.classList.contains('dual-word') &&
                           node.tagName !== 'PRE' &&
                           !node.hasAttribute('data-jit-span')) {
                    Array.from(node.childNodes).forEach(collectTextNodes);
                }
            };
            collectTextNodes(blockEl);

            // Build a globalIdx counter for this paragraph based on all chunks
            let paraWordCounter = 0;
            const allParaEntries = [];
            for (const c of this.chunks) {
                for (const e of c.wordEntries) {
                    if (e.type === 'text' && e.paragraphId === paragraphId) {
                        allParaEntries.push(e);
                    }
                }
            }
            // Sort by globalIdx to get correct order
            allParaEntries.sort((a, b) => a.globalIdx - b.globalIdx);
            const globalIdxToParaPos = new Map();
            allParaEntries.forEach((e, i) => globalIdxToParaPos.set(e.globalIdx, i));

            let paraWordIdx = 0;
            for (const textNode of textNodes) {
                const text = textNode.nodeValue;
                const parts = text.split(/(\s+)/);
                if (parts.length <= 1 && text.trim() === '') continue;

                let needsWrapping = false;
                // Check if any word in this text node needs a span
                let tempIdx = paraWordIdx;
                for (const part of parts) {
                    if (part.trim().length > 0) {
                        const paraEntry = allParaEntries[tempIdx];
                        if (paraEntry && neededGlobalIdxSet.has(paraEntry.globalIdx)) {
                            needsWrapping = true;
                            break;
                        }
                        tempIdx++;
                    }
                }

                if (!needsWrapping) {
                    // Count words to advance the counter
                    for (const part of parts) {
                        if (part.trim().length > 0) paraWordIdx++;
                    }
                    continue;
                }

                const fragment = document.createDocumentFragment();
                for (const part of parts) {
                    if (part.trim().length > 0) {
                        const paraEntry = allParaEntries[paraWordIdx];
                        if (paraEntry && neededGlobalIdxSet.has(paraEntry.globalIdx)) {
                            const spanId = `md-word-${paraEntry.globalIdx}`;
                            const span = document.createElement('span');
                            span.id = spanId;
                            span.className = "transition-all duration-75 ease-in-out rounded inline-block relative";
                            span.setAttribute('data-original-class', span.className);
                            span.setAttribute('data-jit-span', 'true');
                            span.textContent = part;
                            fragment.appendChild(span);

                            // Map back to the chunk's spanIds
                            const matchingEntries = wordsInPara.filter(w => w.globalIdx === paraEntry.globalIdx);
                            for (const me of matchingEntries) {
                                spanIds[me.entryIdx] = spanId;
                            }
                        } else {
                            fragment.appendChild(document.createTextNode(part));
                        }
                        paraWordIdx++;
                    } else {
                        fragment.appendChild(document.createTextNode(part));
                    }
                }
                textNode.parentNode.replaceChild(fragment, textNode);
            }
        });

        chunk.spanIds = spanIds;
    }

    // M-10: Deactivate a chunk — remove JIT spans and restore text nodes
    deactivateChunk(chunkIndex) {
        if (chunkIndex < 0 || chunkIndex >= this.chunks.length) return;
        if (!this._activeChunkIndices.has(chunkIndex)) return;
        this._activeChunkIndices.delete(chunkIndex);

        const chunk = this.chunks[chunkIndex];

        // Collect paragraphs used by this chunk
        const paragraphIds = new Set();
        chunk.wordEntries.forEach(entry => {
            if (entry.type === 'text') paragraphIds.add(entry.paragraphId);
        });

        // Check if any other active chunk still uses the same paragraph
        const stillActiveParagraphs = new Set();
        for (const activeIdx of this._activeChunkIndices) {
            const activeChunk = this.chunks[activeIdx];
            for (const entry of activeChunk.wordEntries) {
                if (entry.type === 'text' && paragraphIds.has(entry.paragraphId)) {
                    stillActiveParagraphs.add(entry.paragraphId);
                }
            }
        }

        // Unwrap paragraphs that are no longer needed
        paragraphIds.forEach(paragraphId => {
            if (stillActiveParagraphs.has(paragraphId)) return;
            const blockEl = this.displayElement.querySelector(`[data-paragraph-id="${paragraphId}"]`);
            if (!blockEl) return;
            this._unwrapJitSpans(blockEl);
        });

        // Clear spanIds
        chunk.spanIds = new Array(chunk.words.length).fill(null);
    }

    // Remove all JIT-created spans within an element, restoring text nodes
    _unwrapJitSpans(element) {
        const jitSpans = element.querySelectorAll('[data-jit-span]');
        jitSpans.forEach(span => {
            const textNode = document.createTextNode(span.textContent);
            span.parentNode.replaceChild(textNode, span);
        });
        // Merge adjacent text nodes
        element.normalize();
    }
}