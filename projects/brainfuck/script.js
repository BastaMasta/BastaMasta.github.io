function interpretBrainfuck(code, input = "") {
    const memory = new Array(30000).fill(0);
    let pointer = 0;
    let inputPointer = 0;
    let output = "";
    let i = 0;

    // Build a map of bracket pairs for efficient jumping
    const bracketMap = {};
    const stack = [];

    for (let pos = 0; pos < code.length; pos++) {
        if (code[pos] === '[') {
            stack.push(pos);
        } else if (code[pos] === ']') {
            if (stack.length === 0) {
                return "Error: Unmatched closing bracket at position " + pos;
            }
            const openPos = stack.pop();
            bracketMap[openPos] = pos;
            bracketMap[pos] = openPos;
        }
    }

    if (stack.length !== 0) {
        return "Error: Unmatched opening bracket at position " + stack.pop();
    }

    // Execute the code
    while (i < code.length) {
        const command = code[i];

        switch (command) {
            case '>':
                pointer++;
                if (pointer >= memory.length) pointer = 0;
                break;
            case '<':
                pointer--;
                if (pointer < 0) pointer = memory.length - 1;
                break;
            case '+':
                memory[pointer] = (memory[pointer] + 1) % 256;
                break;
            case '-':
                memory[pointer] = (memory[pointer] - 1 + 256) % 256;
                break;
            case '.':
                output += String.fromCharCode(memory[pointer]);
                break;
            case ',':
                if (inputPointer < input.length) {
                    memory[pointer] = input.charCodeAt(inputPointer++);
                } else {
                    memory[pointer] = 0; // EOF
                }
                break;
            case '[':
                if (memory[pointer] === 0) {
                    i = bracketMap[i];
                }
                break;
            case ']':
                if (memory[pointer] !== 0) {
                    i = bracketMap[i];
                }
                break;
        }

        i++;
    }

    return output;
}

// Connect the UI to the interpreter

/* ---- page wiring ----
   Everything below used to live inside the click handler, which meant the
   focus listeners were re-registered on every run, and a null #navToggle threw
   part-way through handling the click. */

const runBtn = document.getElementById('run-btn');
const codeInput = document.getElementById('bf-code');
const userInput = document.getElementById('bf-input');
const outputEl = document.getElementById('bf-output');
const statusEl = document.getElementById('bf-status');

function setStatus(text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = 'bf-status' + (kind ? ' is-' + kind : '');
}

function run() {
  const code = codeInput.value;
  const input = userInput.value;
  const started = performance.now();

  try {
    const result = interpretBrainfuck(code, input);
    // textContent, never innerHTML: the program's output is arbitrary bytes,
    // and a program that printed markup would otherwise run it on this origin.
    outputEl.textContent = result || '(no output)';
    outputEl.classList.toggle('is-empty', !result);
    setStatus(`ran in ${(performance.now() - started).toFixed(1)} ms · ${result.length} byte${result.length === 1 ? '' : 's'} out`, 'ok');
  } catch (error) {
    outputEl.textContent = String(error && error.message ? error.message : error);
    outputEl.classList.remove('is-empty');
    setStatus('error', 'err');
  }
}

if (runBtn && codeInput && userInput && outputEl) {
  runBtn.addEventListener('click', run);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { run(); e.preventDefault(); }
  });

  const samples = document.querySelectorAll('[data-sample]');
  samples.forEach((b) => b.addEventListener('click', () => {
    codeInput.value = b.dataset.sample;
    userInput.value = b.dataset.input || '';
    run();
  }));
}
