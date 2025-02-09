function calculateCost() {
    const selectedEvents = document.querySelectorAll('input[name="events[]"]:checked');
    const groupEvents = Array.from(selectedEvents).filter(event =>
        event.getAttribute('data-type') === 'group'
    );

    // Check if quiz or treasure hunt is selected
    const quizSelected = groupEvents.some(event =>
        event.value === "CyberConquest (Quiz - Logo Quiz, Puzzle)"
    );
    const treasureHuntSelected = groupEvents.some(event =>
        event.value === "Quest Beyond Limits (Treasure Hunt)"
    );

    // Check for other group events
    const otherGroupEvents = groupEvents.filter(event =>
        event.value !== "CyberConquest (Quiz - Logo Quiz, Puzzle)" &&
        event.value !== "Quest Beyond Limits (Treasure Hunt)"
    );

    // If any other group events are selected, show special pricing message
    if (otherGroupEvents.length > 0) {
        document.getElementById('totalCost').innerHTML = 'Group Event Registration: Contact Yukti-2K25 Registration Team for Pricing';
        return;
    }

    // Calculate cost for individual events
    const individualEvents = Array.from(selectedEvents).filter(event =>
        event.getAttribute('data-type') !== 'group'
    );

    const costPerEvent = 200;
    let totalCost = 0;

    if (individualEvents.length > 0) {
        totalCost = individualEvents.length * costPerEvent - Math.floor(individualEvents.length / 4) * costPerEvent;
    }

    // Add quiz and treasure hunt costs if selected
    if (quizSelected) {
        totalCost += 300;
    }
    if (treasureHuntSelected) {
        totalCost += 400;
    }

    // Display total cost with explanations if applicable
    let costHtml = `Total Cost: ₹${totalCost}`;
    let explanations = [];

    if (quizSelected) {
        explanations.push('₹300 for quiz team of two');
    }
    if (treasureHuntSelected) {
        explanations.push('₹400 for treasure hunt team of four');
    }

    if (explanations.length > 0) {
        costHtml += '<br><span style="font-size: 0.9em; color: #666;">(includes ' + explanations.join(' and ') + ')</span>';
    }

    document.getElementById('totalCost').innerHTML = costHtml;
}

function updateEvents(category) {
    const events = {
        "Cultural": {
            "individual": [
                "Neon Moves (Dance - Solo)",
                "Echo of the Cosmos (Singing - Solo)",
                "Pixel Chronicles (Photography ,Reel Showdown,Cinematography/Short-Film)",
                "Futuristic Vogue (Ramp Walk - Corporate Walk)",
                "DJ Resonance Reign (Battle of DJs)"
            ],
            "group": [
                "Neon Moves (Dance - Group)",
                "Echo of the Cosmos (Singing - Group)",
                "Circuit Tales (Nukkad Natak)",
                "Resonance Reign (Battle of Bands)",
            ]
        },
        "Technical": {
            "individual": [
                "Code Hunters (Debugging)",
                "Clash of Minds (Technical Debate)",
                "Innovator's Showcase (Technical Paper Presentation)"
            ],
            "group": [
                "Math Matrix (Math Relay)" // tbd
            ]
        },
        "Management": {
            "individual": [
                "Cyber Strategist Challenge (Best Manager)",
                "HR Virtuoso (Best HR)",
                "Hyperloop Innovations (Product Launch - Marketing)",
                "VITI Legends (VITI Masters)",
                "Mimic-AD (AD MAD Show)"
            ],
            "group": [
            ]
        },
        "Gaming & Adventure Zone": {
            "individual": [
                "PixelPlay Zone (GameZone)"
            ],
            "group": [
                "CyberConquest (Quiz - Logo Quiz, Puzzle)",
                "Quest Beyond Limits (Treasure Hunt)"
            ]
        },
        "Art & Creativity": {
            "individual": [
                "Digital Visions (Face Painting)",
                "Neon Spectrum Creations (Rangoli)",
                "Design Evolution (Raw to Beautification)",
                "Visionary Minds (Logo Design)"
            ],
            "group": [
                "Visionary Vibes (Poster Making)",
                "Fragments of Tomorrow (Collage Making)"
            ]
        },
        "Robotics & Mechanical": {
            "individual": [
            ],
            "group": [
                "PathTracer Challenge (Line Follower Robot)",
                "RoboRace Chronicles (RoboRace)",
                "CyberKick Arena (RoboSoccer)",
                "MechaMayhem (RoboWar)",
                "SkyForge 2147 (Aerospace Innovation)"
            ]
        },
        "Open Mic": {
            "individual": [
                "Cyber Expressions (Mimicry)",
                "Glitch and Giggles (Stand-up comedy)",
                "Echoverse (Poetry/Open word/shayari)"
            ],
            "group": [
                "Cyber Masquerade (MIME ACT)"
            ]
        }
    };

    const eventList = events[category] || { "individual": [], "group": [] };
    const eventCheckboxContainer = document.getElementById('eventCheckboxContainer');

    // Combine individual and group events, but tag them
    const allEvents = [
        ...eventList.individual.map(event => ({ name: event, type: 'individual' })),
        ...eventList.group.map(event => ({ name: event, type: 'group' }))
    ];

    eventCheckboxContainer.innerHTML = allEvents.map(event => `
        <div class="checkbox-wrapper">
            <input type="checkbox" 
                   id="${event.name}" 
                   name="events[]" 
                   value="${event.name}" 
                   data-type="${event.type}"
                   onchange="calculateCost()">
            <label for="${event.name}">${event.name} ${event.type === 'group' ? '(Group)' : ''}</label>
        </div>
    `).join('');
}

// Add form validation before submission
document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form');
    form.addEventListener('submit', function(event) {
        const selectedEvents = document.querySelectorAll('input[name="events[]"]:checked').length;

        if (selectedEvents === 0) {
            event.preventDefault(); // Stop form submission
            alert('Please select at least one event before submitting.');

            // Optionally, scroll to the event selection area
            const eventCategorySelect = document.getElementById('eventCategory');
            eventCategorySelect.scrollIntoView({ behavior: 'smooth' });
            eventCategorySelect.focus();
        }
    });

    const popup = document.getElementById('popup-overlay');
    const closeBtn = document.querySelector('.popup-close');
    const acceptBtn = document.querySelector('.popup-accept');

    // Function to show popup
    function showPopup() {
        // Always show popup on reload, regardless of previous visits
        popup.style.display = 'flex';
    }

    // Function to close popup
    function closePopup() {
        popup.style.display = 'none';
    }

    // Show popup when page loads or reloads
    showPopup();

    // Close popup when close button is clicked
    closeBtn.addEventListener('click', closePopup);

    // Close popup when accept button is clicked
    acceptBtn.addEventListener('click', closePopup);

    // Close popup if clicked outside the content
    popup.addEventListener('click', function(event) {
        if (event.target === popup) {
            closePopup();
        }
    });
});

document.getElementById("go-back").onclick = function () {
    location.href = "https://yukti.bastamasta.dev/";
};
