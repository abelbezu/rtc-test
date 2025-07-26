// Select all key elements
const keys = document.querySelectorAll('.key');

/**
 * Plays the sound for a given note and provides visual feedback.
 * @param {string} note - The musical note to play (e.g., 'C4', 'D#4').
 */
function playNote(note) {
    // Find the audio element and the key element
    const audio = new Audio(`https://cdn.jsdelivr.net/gh/Tonejs/Tone.js/examples/audio/salamander/${note}.mp3`);
    const keyElement = document.querySelector(`[data-note="${note}"]`);

    if (keyElement) {
        // Play the sound
        audio.currentTime = 0; // Rewind to the start
        audio.play();

        // Add visual 'active' class
        keyElement.classList.add('active');

        // Remove the 'active' class after the animation/sound ends
        setTimeout(() => {
            keyElement.classList.remove('active');
        }, 200);
    }
}

// Map keyboard keys to musical notes
const keyNoteMap = {};
keys.forEach(key => {
    keyNoteMap[key.dataset.key] = key.dataset.note;
});


// Add event listener for mouse clicks
keys.forEach(key => {
    key.addEventListener('mousedown', () => {
        playNote(key.dataset.note);
    });
});

// Add event listener for keyboard presses
document.addEventListener('keydown', (e) => {
    // Prevent repeated notes when a key is held down
    if (e.repeat) return;
    
    const note = keyNoteMap[e.key];
    if (note) {
        playNote(note);
    }
});