// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Navigation functionality
    setupNavigation();

    // Typing text effect in hero section
    setupTypingEffect();

    // Add scroll animations
    setupScrollAnimations();

    // Setup contact form
    setupContactForm();

    // Add glitch effects on hover
    setupGlitchEffects();
});

// Navigation functionality
function setupNavigation() {
    const navToggle = document.getElementById('navToggle');
    const navItems = document.querySelector('.nav-items');

    // Mobile menu toggle
    navToggle.addEventListener('click', function() {
        navToggle.classList.toggle('active');
        navItems.classList.toggle('active');
    });

    // Smooth scrolling for nav links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();

            // Close mobile menu when a link is clicked
            navToggle.classList.remove('active');
            navItems.classList.remove('active');

            // Smooth scroll to section
            const targetId = this.getAttribute('href');
            const targetSection = document.querySelector(targetId);

            if (targetSection) {
                window.scrollTo({
                    top: targetSection.offsetTop - 70, // Offset for fixed header
                    behavior: 'smooth'
                });
            }
        });
    });

    // Highlight active nav link on scroll
    window.addEventListener('scroll', highlightActiveNavLink);
}

// Highlight the active section in navigation
function highlightActiveNavLink() {
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.nav-link');

    let current = '';
    const scrollPosition = window.scrollY + 100; // Add offset for better UX

    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;

        if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${current}`) {
            link.classList.add('active');
        }
    });
}

// Typing text effect in the hero section
function setupTypingEffect() {
    const textElement = document.querySelector('.typing-text');
    const texts = ["RUST DEVELOPER", "SYSTEMS PROGRAMMER", "EMBEDDED SYSTEMS ENGINEER", "GAME DEVELOPER"];
    let textIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let typingSpeed = 100;

    function type() {
        const currentText = texts[textIndex];

        if (isDeleting) {
            // Deleting text
            textElement.textContent = currentText.substring(0, charIndex - 1);
            charIndex--;
            typingSpeed = 50; // Faster when deleting
        } else {
            // Typing text
            textElement.textContent = currentText.substring(0, charIndex + 1);
            charIndex++;
            typingSpeed = 100; // Normal typing speed
        }

        // Handle text completion or deletion
        if (!isDeleting && charIndex === currentText.length) {
            // Text completed, pause before deleting
            isDeleting = true;
            typingSpeed = 1500; // Pause at the end
        } else if (isDeleting && charIndex === 0) {
            // Text deleted, move to next text
            isDeleting = false;
            textIndex = (textIndex + 1) % texts.length;
            typingSpeed = 500; // Pause before starting new text
        }

        setTimeout(type, typingSpeed);
    }

    // Start the typing effect
    setTimeout(type, 1000);
}

// Scroll animations
function setupScrollAnimations() {
    // Reveal elements on scroll
    const revealElements = document.querySelectorAll('.section-header, .project-card, .skill-item, .stat-box, .contact-item');

    function revealOnScroll() {
        const windowHeight = window.innerHeight;

        revealElements.forEach(element => {
            const elementTop = element.getBoundingClientRect().top;

            if (elementTop < windowHeight - 50) {
                element.classList.add('revealed');
            }
        });
    }

    // Initial check
    revealOnScroll();

    // Check on scroll
    window.addEventListener('scroll', revealOnScroll);

    // Parallax effect for background
    window.addEventListener('scroll', function() {
        const scrollPosition = window.scrollY;
        const gridOverlay = document.querySelector('.grid-overlay');

        if (gridOverlay) {
            gridOverlay.style.transform = `translateY(${scrollPosition * 0.1}px)`;
        }
    });
}

// Contact form submission
function setupContactForm() {
    const contactForm = document.getElementById('contactForm');

    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();

            // Get form values
            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const subject = document.getElementById('subject').value;
            const message = document.getElementById('message').value;

            // Form validation (simple)
            if (!name || !email || !subject || !message) {
                showFormMessage('Please fill all fields', 'error');
                return;
            }

            // Show sending message
            showFormMessage('Sending message...', 'info');

            // Create FormData object
            const formData = new FormData(contactForm);

            // Submit the form data to Formspree
            fetch('https://formspree.io/f/meoeplwk', {
                method: 'POST',
                body: formData,
                headers: {
                    'Accept': 'application/json'
                }
            })
                .then(response => {
                    if (response.ok) {
                        // Show success message
                        showFormMessage('Message sent successfully!', 'success');
                        // Reset form
                        contactForm.reset();
                        // Clear success message after a few seconds
                        setTimeout(function() {
                            clearFormMessage();
                        }, 3000);
                    } else {
                        // Show error message
                        showFormMessage('Failed to send message. Please try again.', 'error');
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    showFormMessage('An error occurred. Please try again.', 'error');
                });
        });
    }
}

// Show form messages
function showFormMessage(message, type) {
    // Remove any existing message
    clearFormMessage();

    // Create message element
    const messageElement = document.createElement('div');
    messageElement.className = `form-message ${type}`;
    messageElement.textContent = message;

    // Add to form
    const form = document.getElementById('contactForm');
    form.appendChild(messageElement);
}

// Clear form messages
function clearFormMessage() {
    const existingMessage = document.querySelector('.form-message');
    if (existingMessage) {
        existingMessage.remove();
    }
}

// Glitch effects on hover for elements
function setupGlitchEffects() {
    // Glitch effect for section titles on hover
    const sectionTitles = document.querySelectorAll('.glitch');

    sectionTitles.forEach(title => {
        title.addEventListener('mouseenter', function() {
            this.classList.add('glitching');
        });

        title.addEventListener('mouseleave', function() {
            this.classList.remove('glitching');
        });
    });

    // Random glitch effect on the overlay
    const glitchOverlay = document.querySelector('.glitch-overlay');

    if (glitchOverlay) {
        setInterval(function() {
            if (Math.random() > 0.95) { // Occasionally glitch
                glitchOverlay.classList.add('active');

                setTimeout(function() {
                    glitchOverlay.classList.remove('active');
                }, 200 + Math.random() * 400); // Random duration
            }
        }, 2000);
    }

    // Cyber button effects
    const cyberButtons = document.querySelectorAll('.cyber-button');

    cyberButtons.forEach(button => {
        button.addEventListener('mouseenter', function() {
            this.querySelector('.cyber-button-glitch')?.classList.add('active');
        });

        button.addEventListener('mouseleave', function() {
            this.querySelector('.cyber-button-glitch')?.classList.remove('active');
        });
    });
}

// Add active class to inputs when they have content or focus
document.addEventListener('DOMContentLoaded', function() {
    const inputs = document.querySelectorAll('.cyber-input, .cyber-textarea');

    inputs.forEach(input => {
        // Check initial state
        if (input.value) {
            input.classList.add('has-content');
        }

        // Add events
        input.addEventListener('focus', function() {
            this.parentNode.classList.add('focused');
        });

        input.addEventListener('blur', function() {
            this.parentNode.classList.remove('focused');
            if (this.value) {
                this.classList.add('has-content');
            } else {
                this.classList.remove('has-content');
            }
        });

        input.addEventListener('input', function() {
            if (this.value) {
                this.classList.add('has-content');
            } else {
                this.classList.remove('has-content');
            }
        });
    });
});

// Add some particles to the background
function setupParticles() {
    const backgroundContainer = document.querySelector('.background-container');

    if (backgroundContainer) {
        // Create canvas for particles
        const canvas = document.createElement('canvas');
        canvas.className = 'particles-canvas';
        backgroundContainer.appendChild(canvas);

        const ctx = canvas.getContext('2d');

        // Set canvas size
        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // Particle properties
        const particles = [];
        const particleCount = 50;

        // Create particles
        for (let i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                radius: Math.random() * 2 + 1,
                color: `rgba(0, 255, 255, ${Math.random() * 0.5 + 0.1})`,
                speedX: Math.random() * 2 - 1,
                speedY: Math.random() * 2 - 1
            });
        }

        // Animation loop
        function animateParticles() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            particles.forEach(particle => {
                // Move particle
                particle.x += particle.speedX;
                particle.y += particle.speedY;

                // Wrap around edges
                if (particle.x < 0) particle.x = canvas.width;
                if (particle.x > canvas.width) particle.x = 0;
                if (particle.y < 0) particle.y = canvas.height;
                if (particle.y > canvas.height) particle.y = 0;

                // Draw particle
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                ctx.fillStyle = particle.color;
                ctx.fill();
            });

            requestAnimationFrame(animateParticles);
        }

        animateParticles();
    }
}

// Initialize particles
setupParticles();

// Add a cool scanline effect
document.addEventListener('DOMContentLoaded', function() {
    const scanline = document.querySelector('.scanline');

    if (scanline) {
        // Make scanline move down the screen
        function animateScanline() {
            scanline.style.top = '0';
            scanline.style.transition = 'none';

            setTimeout(() => {
                scanline.style.top = '100%';
                scanline.style.transition = 'top 8s linear';

                // Repeat
                setTimeout(animateScanline, 8000);
            }, 100);
        }

        animateScanline();
    }
});