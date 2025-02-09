// Comprehensive events data with participant limits and details
const EVENTS = {
    "Cultural": {
        "individual": [
            "Neon Moves (Dance - Solo)",
            "Echo of the Cosmos (Singing - Solo)",
            "Futuristic Vogue (Ramp Walk - Corporate Walk)",
            "DJ Resonance Reign (Battle of DJs)"
        ],
        "group": [
            {
                name: "Neon Moves (Dance - Group)",
                minParticipants: 4,
                maxParticipants: 15,
                baseCost: 200,
            },
            {
                name: "Echo of the Cosmos (Singing - Group)",
                minParticipants: 2,
                maxParticipants: 6,
                baseCost: 200,
            },
            {
                name: "Circuit Tales (Nukkad Natak)",
                minParticipants: 4,
                maxParticipants: 15,
                baseCost: 200,
            },
            {
                name: "Resonance Reign (Battle of Bands)",
                minParticipants: 3, // TBD
                maxParticipants: 7,
                baseCost: 200,
            },
            {
                name: "Pixel Chronicles (Photography ,Reel Showdown,Cinematography/Short-Film)",
                minParticipants: 1,
                maxParticipants: 3,
                baseCost: 200,
            }
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
    "Technical": {
        "individual": [
            "Code Hunters (Debugging)",
            "Clash of Minds (Technical Debate)",
            "Innovator's Showcase (Technical Paper Presentation)"
        ],
        "group": [
            {
                name: "Math Matrix (Math Relay)",
                minParticipants: 2,
                maxParticipants: 5,
                baseCost: 200,
                flatRateCost: 1000
            }
        ]
    },
    "Gaming & Adventure Zone": {
        "individual": [
            "PixelPlay Zone (GameZone)"
        ],
        "group": [
            {
                name: "CyberConquest (Quiz - Logo Quiz, Puzzle)",
                minParticipants: 2,
                maxParticipants: 2,
                fixedTeamCost: 300,
                exactParticipants: 2
            },
            {
                name: "Quest Beyond Limits (Treasure Hunt)",
                minParticipants: 4,
                maxParticipants: 4,
                fixedTeamCost: 400,
                exactParticipants: 4
            }
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
            {
                name: "Visionary Vibes (Poster Making)",
                minParticipants: 1,
                maxParticipants: 2,
                baseCost: 200,
                flatRateCost: 1000
            },
            {
                name: "Fragments of Tomorrow (Collage Making)",
                minParticipants: 1,
                maxParticipants: 2,
                baseCost: 200,
                flatRateCost: 1000
            }
        ]
    },
    "Robotics & Mechanical": {
        "individual": [],
        "group": [
            {
                name: "PathTracer Challenge (Line Follower Robot)",
                minParticipants: 1,
                maxParticipants: 4,
                fixedTeamCost: 400,
                flexibleTeamSize: true
            },
            {
                name: "RoboRace Chronicles (RoboRace)",
                minParticipants: 1,
                maxParticipants: 4,
                fixedTeamCost: 400,
                flexibleTeamSize: true
            },
            {
                name: "CyberKick Arena (RoboSoccer)",
                minParticipants: 1,
                maxParticipants: 4,
                fixedTeamCost: 400,
                flexibleTeamSize: true
            },
            {
                name: "MechaMayhem (RoboWar)",
                minParticipants: 1,
                maxParticipants: 4,
                fixedTeamCost: 400,
                flexibleTeamSize: true
            },
            {
                name: "SkyForge 2147 (Aerospace Innovation)",
                minParticipants: 3,
                maxParticipants: 6,
                baseCost: 200,
                flatRateCost: 1000
            }
        ]
    },
    "Open Mic": {
        "individual": [
            "Cyber Expressions (Mimicry)",
            "Glitch and Giggles (Stand-up comedy)",
            "Echoverse (Poetry/Open word/shayari)"
        ],
        "group": [
            {
                name: "Cyber Masquerade (MIME ACT)",
                minParticipants: 3,
                maxParticipants: 6,
                baseCost: 200,
                flatRateCost: 1000
            }
        ]
    }
};

const CONCERT_TIERS = {
    "platinum": {
        price: 1000,
        maxTickets: 10,
        description: "Starting 1st Row"
    },
    "gold": {
        price: 600,
        maxTickets: null,
        description: "Middle Rows"
    },
    "silver": {
        price: 250,
        maxTickets: null, // unlimited
        description: "Last Rows"
    },
    "bronze": {
        price: 50,
        maxTickets: null, // unlimited
        description: "Standing Pit"
    }
};

// Update events based on selected category
function updateEvents(category) {
    const eventList = EVENTS[category] || { "individual": [], "group": [] };
    const eventCheckboxContainer = document.getElementById('eventCheckboxContainer');

    // Combine individual and group events
    const allEvents = [
        ...eventList.individual.map(event => ({
            name: event,
            type: 'individual',
            minParticipants: 1,
            maxParticipants: 1
        })),
        ...eventList.group.map(event => ({
            ...event,
            type: 'group'
        }))
    ];

    // Generate HTML for events
    eventCheckboxContainer.innerHTML = allEvents.map(event => `
        <div class="checkbox-wrapper">
            <input type="checkbox" 
                   id="${event.name}" 
                   name="events[]" 
                   value="${event.name}" 
                   data-type="${event.type}"
                   data-min-participants="${event.minParticipants}"
                   data-max-participants="${event.maxParticipants}"
                   ${event.exactParticipants ? `data-exact-participants="${event.exactParticipants}"` : ''}
                   onchange="toggleParticipantInput(this)">
            <label for="${event.name}">
                ${event.name} ${event.type === 'group' ? '(Group)' : ''}
            </label>
            
            ${event.type === 'group' ? `
            <div id="participant-input-${event.name}" class="participant-input" style="display:none;">
                <label for="participants-${event.name}">
                    Number of Participants (${event.minParticipants}-${event.maxParticipants}):
                </label>
                <input type="number" 
                       id="participants-${event.name}" 
                       name="participants-${event.name}"
                       min="${event.minParticipants}" 
                       max="${event.maxParticipants}"
                       onchange="calculateCost()">
            </div>
            ` : ''}
        </div>
    `).join('');

    calculateCost();
}

// Handle concert ticket selection
function updateConcertInputs(tier) {
    const inputsDiv = document.getElementById('concertTicketInputs');
    const ticketCount = document.getElementById('ticketCount');
    const noteDiv = document.getElementById('ticketNote');

    if (!tier) {
        inputsDiv.style.display = 'none';
        ticketCount.value = '';
        calculateCost();
        return;
    }

    const tierDetails = CONCERT_TIERS[tier];
    inputsDiv.style.display = 'block';

    // Update max tickets and note
    if (tierDetails.maxTickets) {
        ticketCount.max = tierDetails.maxTickets;
        noteDiv.textContent = `Maximum ${tierDetails.maxTickets} tickets allowed`;
    } else {
        ticketCount.removeAttribute('max');
        noteDiv.textContent = '';
    }

    ticketCount.value = '';
    calculateCost();
}

// Toggle participant input for group events
function toggleParticipantInput(checkbox) {
    const eventName = checkbox.value;
    const participantInputDiv = document.getElementById(`participant-input-${eventName}`);
    const participantInput = document.getElementById(`participants-${eventName}`);

    if (checkbox.checked && checkbox.getAttribute('data-type') === 'group') {
        participantInputDiv.style.display = 'block';
        participantInput.required = true;
    } else {
        if (participantInputDiv) {
            participantInputDiv.style.display = 'none';
            participantInput.required = false;
            participantInput.value = '';
        }
    }

    calculateCost();
}

// Calculate total cost
function calculateCost() {
    const selectedEvents = document.querySelectorAll('input[name="events[]"]:checked');
    let totalCost = 0;
    let costDetails = [];

    // Calculate individual event costs
    const individualEvents = Array.from(selectedEvents)
        .filter(event => event.getAttribute('data-type') === 'individual');

    if (individualEvents.length > 0) {
        totalCost = individualEvents.length * 200 - Math.floor(individualEvents.length / 4) * 200;
        costDetails.push(`Individual Events: ₹${totalCost} (${individualEvents.length} events)`);
    }

    // Calculate group event costs
    const groupEvents = Array.from(selectedEvents)
        .filter(event => event.getAttribute('data-type') === 'group');

    groupEvents.forEach(event => {
        const participantInput = document.getElementById(`participants-${event.value}`);
        const participantCount = parseInt(participantInput.value) || 0;

        const eventDetails = Object.values(EVENTS)
            .flatMap(category => category.group)
            .find(e => e.name === event.value);

        if (eventDetails && participantCount >= eventDetails.minParticipants) {
            let eventCost = 0;
            let priceExplanation = '';

            // Fixed price robotics events
            if (eventDetails.fixedTeamCost && eventDetails.flexibleTeamSize) {
                if (participantCount <= eventDetails.maxParticipants) {
                    eventCost = eventDetails.fixedTeamCost;
                    priceExplanation = "Fixed team price";
                }
            }
            // Quiz event
            else if (event.value === "CyberConquest (Quiz - Logo Quiz, Puzzle)" && participantCount === 2) {
                eventCost = 300;
                priceExplanation = "Fixed price for quiz team";
            }
            // Treasure Hunt event
            else if (event.value === "Quest Beyond Limits (Treasure Hunt)" && participantCount === 4) {
                eventCost = 400;
                priceExplanation = "Fixed price for treasure hunt team";
            }
            // Standard group pricing
            else {
                if (participantCount <= 4) {
                    eventCost = participantCount * 200;
                    priceExplanation = `@₹200 per person`;
                }
                else if (participantCount <= 10) {
                    const basePrice = 4 * 200;
                    const additionalPeople = participantCount - 4;
                    const additionalPrice = additionalPeople * 150;
                    eventCost = Math.min(basePrice + additionalPrice, 1200);
                    priceExplanation = `(First 4 @₹200, others @₹150, capped at ₹1200)`;
                }
                else {
                    const extraPeople = participantCount - 10;
                    eventCost = 1200 + (extraPeople * 100);
                    priceExplanation = `(₹1200 for first 10, +₹100 per additional person)`;
                }
            }

            if (eventCost > 0) {
                totalCost += eventCost;
                costDetails.push(`${event.value}: ₹${eventCost} (${participantCount} participants ${priceExplanation})`);
            }
        }
    });

    // Calculate concert ticket costs
    const selectedTier = document.getElementById('concertTickets').value;
    if (selectedTier) {
        const ticketCount = parseInt(document.getElementById('ticketCount').value) || 0;
        const tierDetails = CONCERT_TIERS[selectedTier];

        if (ticketCount > 0) {
            const ticketCost = ticketCount * tierDetails.price;
            costDetails.push(`Concert (${selectedTier}): ₹${ticketCost} (${ticketCount} tickets @ ₹${tierDetails.price})`);
            totalCost += ticketCost;
        }
    }

    // Update total cost display
    const totalCostElement = document.getElementById('totalCost');
    let costHtml = `Total Cost: ₹${totalCost}`;
    if (costDetails.length > 0) {
        costHtml += '<br><span style="font-size: 0.9em; color: #666;">Breakdown:<br>' +
            costDetails.join('<br>') + '</span>';
    }
    totalCostElement.innerHTML = costHtml;
}

// Form validation before submission
// Form validation
document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form');
    form.addEventListener('submit', function(event) {
        const selectedEvents = document.querySelectorAll('input[name="events[]"]:checked');
        const selectedConcertTier = document.getElementById('concertTickets').value;
        const ticketCount = document.getElementById('ticketCount').value;

        // Check if either events or concert tickets are selected
        if (selectedEvents.length === 0 && !selectedConcertTier) {
            event.preventDefault();
            alert('Please select at least one event or concert tickets before submitting.');
            document.getElementById('eventCategory').scrollIntoView({ behavior: 'smooth' });
            return;
        }

        // Validate group event participant counts
        for (let checkbox of selectedEvents) {
            if (checkbox.getAttribute('data-type') === 'group') {
                const participantInput = document.getElementById(`participants-${checkbox.value}`);
                const participantCount = parseInt(participantInput.value);
                const minParticipants = parseInt(checkbox.getAttribute('data-min-participants'));
                const maxParticipants = parseInt(checkbox.getAttribute('data-max-participants'));
                const exactParticipants = checkbox.getAttribute('data-exact-participants');

                // Check if participant count is missing
                if (!participantCount) {
                    event.preventDefault();
                    alert(`Please enter the number of participants for "${checkbox.value}".`);
                    participantInput.focus();
                    return;
                }

                // Validation for events with exact participant requirements
                if (exactParticipants) {
                    if (participantCount !== parseInt(exactParticipants)) {
                        event.preventDefault();
                        alert(`For "${checkbox.value}", you must have exactly ${exactParticipants} participants.`);
                        participantInput.focus();
                        return;
                    }
                }
                // Validation for other group events
                else if (participantCount < minParticipants || participantCount > maxParticipants) {
                    event.preventDefault();
                    alert(`For "${checkbox.value}", please enter a number of participants between ${minParticipants} and ${maxParticipants}.`);
                    participantInput.focus();
                    return;
                }
            }
        }

        // Concert ticket validation
        if (selectedConcertTier) {
            // Check if ticket count is missing
            if (!ticketCount || ticketCount < 1) {
                event.preventDefault();
                alert('Please specify the number of concert tickets.');
                document.getElementById('ticketCount').focus();
                return;
            }

            const tierDetails = CONCERT_TIERS[selectedConcertTier];
            const ticketCountNum = parseInt(ticketCount);

            // Validate maximum ticket limits
            if (tierDetails.maxTickets && ticketCountNum > tierDetails.maxTickets) {
                event.preventDefault();
                alert(`Maximum ${tierDetails.maxTickets} tickets allowed for ${selectedConcertTier} tier.`);
                document.getElementById('ticketCount').focus();
                return;
            }

            // Validate minimum ticket count
            if (ticketCountNum < 1) {
                event.preventDefault();
                alert('Please enter a valid number of tickets (minimum 1).');
                document.getElementById('ticketCount').focus();
                return;
            }
        }

        // If all validations pass, calculate final cost
        calculateCost();
    });

    // Add popup event listener
    const popupOverlay = document.getElementById('popup-overlay');
    const popupClose = document.querySelector('.popup-close');
    const popupAccept = document.querySelector('.popup-accept');

    if (popupClose) {
        popupClose.addEventListener('click', function() {
            popupOverlay.style.display = 'none';
        });
    }

    if (popupAccept) {
        popupAccept.addEventListener('click', function() {
            popupOverlay.style.display = 'none';
        });
    }
});