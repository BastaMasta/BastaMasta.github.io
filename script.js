document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('js-enabled');

    setupNavigation();
    setupTypingEffect();
    setupScrollReveal();
    setupProjectFilter();
    setupContactForm();
});

function setupNavigation() {
    const nav = document.getElementById('sitenav');
    const navToggle = document.getElementById('navToggle');
    const navItems = document.querySelector('.nav-items');

    if (navToggle && navItems) {
        navToggle.addEventListener('click', function () {
            navToggle.classList.toggle('active');
            navItems.classList.toggle('active');
        });
    }

    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (!targetId || targetId.charAt(0) !== '#') return;
            const targetSection = document.querySelector(targetId);
            if (!targetSection) return;

            e.preventDefault();
            if (navToggle) navToggle.classList.remove('active');
            if (navItems) navItems.classList.remove('active');

            window.scrollTo({
                top: targetSection.offsetTop - 70,
                behavior: 'smooth'
            });
        });
    });

    let ticking = false;
    window.addEventListener('scroll', function () {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(function () {
                if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
                highlightActiveNavLink();
                ticking = false;
            });
        }
    }, { passive: true });

    if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
    highlightActiveNavLink();
}

function highlightActiveNavLink() {
    const sections = document.querySelectorAll('main section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    let current = '';
    const scrollPosition = window.scrollY + 100;

    sections.forEach(section => {
        const top = section.offsetTop;
        const height = section.clientHeight;
        if (scrollPosition >= top && scrollPosition < top + height) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
    });
}

function setupTypingEffect() {
    const textElement = document.querySelector('.typing-text');
    if (!textElement) return;

    const texts = ['RUST DEVELOPER', 'SYSTEMS PROGRAMMER', 'EMBEDDED SYSTEMS ENGINEER', 'GAME DEVELOPER', 'SELF-HOSTING ENTHUSIAST'];
    let textIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        textElement.textContent = texts[0];
        return;
    }

    function type() {
        const currentText = texts[textIndex];
        let speed = 100;

        if (isDeleting) {
            textElement.textContent = currentText.substring(0, charIndex - 1);
            charIndex--;
            speed = 40;
        } else {
            textElement.textContent = currentText.substring(0, charIndex + 1);
            charIndex++;
            speed = 90;
        }

        if (!isDeleting && charIndex === currentText.length) {
            isDeleting = true;
            speed = 1500;
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            textIndex = (textIndex + 1) % texts.length;
            speed = 400;
        }

        setTimeout(type, speed);
    }

    setTimeout(type, 900);
}

function setupScrollReveal() {
    const revealElements = document.querySelectorAll('.reveal');

    if (!('IntersectionObserver' in window) || !revealElements.length) {
        revealElements.forEach(el => el.classList.add('revealed'));
        return;
    }

    const observer = new IntersectionObserver(function (entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                observer.unobserve(entry.target);
            }
        });
    }, { rootMargin: '0px 0px -50px 0px', threshold: 0.05 });

    revealElements.forEach(el => observer.observe(el));
}

function setupProjectFilter() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    const cards = document.querySelectorAll('.project-card');
    if (!filterButtons.length || !cards.length) return;

    filterButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            filterButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            const filter = this.getAttribute('data-filter');
            cards.forEach(card => {
                const match = filter === 'all' || card.getAttribute('data-status') === filter;
                card.classList.toggle('is-hidden', !match);
            });
        });
    });
}

function setupContactForm() {
    const contactForm = document.getElementById('contactForm');
    if (!contactForm) return;

    contactForm.addEventListener('submit', function (e) {
        e.preventDefault();

        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const subject = document.getElementById('subject').value;
        const message = document.getElementById('message').value;

        if (!name || !email || !subject || !message) {
            showFormMessage('Please fill all fields', 'error');
            return;
        }

        showFormMessage('Sending message...', 'info');

        const formData = new FormData(contactForm);

        fetch(contactForm.action, {
            method: 'POST',
            body: formData,
            headers: { Accept: 'application/json' }
        })
            .then(response => {
                if (response.ok) {
                    showFormMessage('Message sent successfully!', 'success');
                    contactForm.reset();
                    setTimeout(clearFormMessage, 3000);
                } else {
                    showFormMessage('Failed to send message. Please try again.', 'error');
                }
            })
            .catch(() => {
                showFormMessage('An error occurred. Please try again.', 'error');
            });
    });
}

function showFormMessage(message, type) {
    clearFormMessage();
    const messageElement = document.createElement('div');
    messageElement.className = `form-message ${type}`;
    messageElement.textContent = message;
    document.getElementById('contactForm').appendChild(messageElement);
}

function clearFormMessage() {
    const existing = document.querySelector('.form-message');
    if (existing) existing.remove();
}
