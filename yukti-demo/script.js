// noinspection DuplicatedCode

// Loading Logic
window.addEventListener('load', () => {
    const loadingScreen = document.getElementById('loading-screen');

    // Set initial styles for transition (important for smooth transitions)
    loadingScreen.style.transition = 'transform 1s ease-in-out, opacity 1s ease-in-out, visibility 1s'; // Adjust duration as needed
    loadingScreen.style.opacity = '1'; // Ensure it's visible initially
    loadingScreen.style.transform = 'scale(1)'; // Ensure it starts at normal size

    // Ensure minimum loading time of 2 seconds for visual effect
    setTimeout(() => {
        // Apply scaling and fade effect
        loadingScreen.style.transform = 'scale(1.5)'; // Scale up - adjust the scale factor as needed
        loadingScreen.style.opacity = '0';
        // Use a setTimeout to delay the visibility change until after the transition
        setTimeout(() => {
            loadingScreen.style.visibility = 'hidden';
            document.body.style.overflow = 'auto'; // Enable scrolling only after visibility is hidden
        }, 1000); // Wait for the transition to complete (match transition duration)
    }, 2000);
});

document.body.style.overflow = 'hidden'; // Prevent scrolling during load

// Add parallax effect to grid background
document.addEventListener('mousemove', (e) => {
    const grid = document.querySelector('.grid-bg');
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;

    grid.style.transform = `rotate(-45deg) translate(${x * 20}px, ${y * 20}px)`;
});

// Add countdown timer functionality
function updateCountdown() {
    const eventDate = new Date('2025-02-20T09:00:00').getTime();
    const now = new Date().getTime();
    const timeLeft = eventDate - now;

    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

    document.getElementById('days').textContent = days.toString().padStart(2, '0');
    document.getElementById('hours').textContent = hours.toString().padStart(2, '0');
    document.getElementById('minutes').textContent = minutes.toString().padStart(2, '0');
    document.getElementById('seconds').textContent = seconds.toString().padStart(2, '0');
}
setInterval(updateCountdown, 1000);
updateCountdown();


// Add glitch effect on hover
document.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
        const title = card.querySelector('h3');
        title.style.animation = 'glitch 500ms infinite';
    });
    
    card.addEventListener('mouseleave', () => {
        const title = card.querySelector('h3');
        title.style.animation = 'none';
    });
});

// Highlight active section in navbar
const sections = document.querySelectorAll('.content, .hero');
const navLinks = document.querySelectorAll('.nav-link');

// Function to update active link
const updateActiveLink = () => {
    let current = '';

    sections.forEach(section => {
        const sectionTop = section.offsetTop;

        if (window.scrollY >= (sectionTop - 150)) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href').slice(1) === current) {
            link.style.color = 'var(--neon-blue)';
        } else {
            link.style.color = 'white';
        }
    });
};

// Handle event card clicks
document.querySelectorAll('.event-card').forEach(card => {
    // Add click handler
    card.addEventListener('click', () => {
        // Open in new tab
        location.href = card.dataset.url;
    });
    // Make cards focusable
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
});

// Back to top button functionality
const backToTop = document.getElementById('backToTop');

window.addEventListener('scroll', () => {
    if (window.scrollY > 500) {
        backToTop.classList.add('visible');
    } else {
        backToTop.classList.remove('visible');
    }
});

backToTop.addEventListener('click', () => {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
});

// Site Enhancements

// better scroll progress algorithm
function initScrollProgress() {
    const scrollProgress = document.querySelector('.scroll-progress');

    window.addEventListener('scroll', () => {
        const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
        const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scrolled = (winScroll / height) * 100;

        scrollProgress.style.width = `${scrolled}%`;
    });
}

// better event card glow and resize
function enhanceEventCardInteraction() {
    const eventCards = document.querySelectorAll('.event-card');

    eventCards.forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'scale(1.03)';
            card.style.boxShadow = '0 10px 20px rgba(0, 255, 249, 0.3)';
            const title = card.querySelector('h3');
            title.style.color = 'var(--neon-pink)';
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = 'scale(1)';
            card.style.boxShadow = 'none';
            const title = card.querySelector('h3');
            title.style.color = 'var(--neon-blue)';
        });
    });
}

// make events cards open links on enter
function improveAccessibility() {
    // Add keyboard navigation to event cards
    const eventCards = document.querySelectorAll('.event-card');

    eventCards.forEach(card => {
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');

        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                card.click();
            }
        });
    });

    // Add aria labels and improve semantics
    document.querySelectorAll('section').forEach(section => {
        section.setAttribute('aria-label', section.querySelector('h2')?.textContent || 'Section');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initScrollProgress();
    enhanceEventCardInteraction();
    improveAccessibility();
});


window.onload = function () {
    document.getElementById("disclaimer-popup").style.display = "flex";
};

function closeDisclaimer() {
    document.getElementById("disclaimer-popup").style.display = "none";
}


// Lazy Loading for images. no images yet to lazy load. all essential to website
// document.addEventListener('DOMContentLoaded', () => {
//     const lazyImages = document.querySelectorAll('img[loading="lazy"]');
//     const imageObserver = new IntersectionObserver((entries, observer) => {
//         entries.forEach(entry => {
//             if (entry.isIntersecting) {
//                 const img = entry.target;
//                 img.src = img.dataset.src;
//                 img.classList.add('loaded');
//                 observer.unobserve(img);
//             }
//         });
//     });
//
//     lazyImages.forEach(img => imageObserver.observe(img));
// });
