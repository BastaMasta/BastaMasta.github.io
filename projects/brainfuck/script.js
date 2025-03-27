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
const runBtn = document.getElementById('run-btn');
const codeInput = document.getElementById('bf-code');
const userInput = document.getElementById('bf-input');
const outputEl = document.getElementById('bf-output');

runBtn.addEventListener('click', function() {
    const code = codeInput.value;
    const input = userInput.value;

    // Add cyberpunk animation effect to button
    this.classList.add('glitch');
    setTimeout(() => this.classList.remove('glitch'), 500);

    try {
        const result = interpretBrainfuck(code, input);
        outputEl.innerHTML = ""; // Clear previous output

        // Add a typing effect to output
        let typingOutput = "";
        let index = 0;

        function typeEffect() {
            if (index < result.length) {
                typingOutput += result[index];
                outputEl.innerHTML = typingOutput;
                index++;
                setTimeout(typeEffect, 50); // Adjust typing speed
            }
        }

        if (result) {
            typeEffect();
        } else {
            outputEl.innerHTML = '<span style="color:#888">No output</span>';
        }

    } catch (error) {
        outputEl.innerHTML = `<span style="color:red">Error: ${error.message}</span>`;
    }

    // Cyberpunk Navbar Toggle
    const navToggle = document.getElementById('navToggle');
    const navItems = document.querySelector('.nav-items');

    navToggle.addEventListener('click', function() {
        navItems.classList.toggle('active');
        navToggle.classList.toggle('active');
    });

    // Cyberpunk Input Effects
    const bfCodeInput = document.getElementById('bf-code');
    bfCodeInput.addEventListener('focus', () => bfCodeInput.classList.add('cyber-active'));
    bfCodeInput.addEventListener('blur', () => bfCodeInput.classList.remove('cyber-active'));
});
