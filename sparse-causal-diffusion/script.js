// Video data with prompts
const videoData = [
    { id: 1, prompt: "A cinematic scene from a classic western movie, featuring a rugged man riding a powerful horse through the vast Gobi Desert at sunset." },
    { id: 2, prompt: "A dramatic and dynamic scene depicting a powerful tsunami rushing through a narrow alley in Bulgaria." },
    { id: 3, prompt: "A vibrant anime illustration of a pink pig running rapidly towards the camera in a narrow alley in Tokyo." },
    { id: 4, prompt: "A vintage drag racing scene featuring six muscle cars lined up at the starting line." },
    { id: 5, prompt: "A mesmerizing video capturing the slow flow of molten lava down the side of a dormant volcano." },
    { id: 6, prompt: "A slow-motion video capturing the intricate process of pouring a drink into a classic martini glass." },
    { id: 7, prompt: "A stunning mid-afternoon landscape photograph showcasing giant wooly mammoths treading through a snowy meadow." },
    { id: 8, prompt: "A dramatic close-up of a rainstorm, capturing the intense droplets of rain hitting various surfaces." },
    { id: 9, prompt: "A drone view of waves crashing against the rugged cliffs along Big Sur's Garay Point beach." },
    { id: 10, prompt: "A vibrant illustration depicting a person conducting an orchestra of flowers." },
    { id: 11, prompt: "A realistic photograph capturing a young woman with wide-eyed astonishment at a stunning panoramic view." },
    { id: 12, prompt: "A whimsical illustration depicting two blobs in a passionate dance of love." },
    { id: 13, prompt: "A whimsical, hand-drawn illustration depicting a ball of wool transforming into a cute, fluffy cat." },
    { id: 14, prompt: "A dynamic scene capturing a young man dipping a crispy French fry into ketchup." },
    { id: 15, prompt: "A slow-motion video depicting the gradual injection of ink into a tank of water." },
    { id: 16, prompt: "A tilt-shift photograph of a spooky haunted mansion with a warm, inviting atmosphere." },
    { id: 17, prompt: "A tropical island beach scene featuring a corgi wearing stylish sunglasses walking along the sandy shore." },
    { id: 18, prompt: "A full-body shot of a man crafted entirely from rocks, walking through a dense forest." },
    { id: 19, prompt: "A close-up shot of a young woman driving a car, lost in thought as she gazes ahead." },
    { id: 20, prompt: "A traditional Chinese dining scene capturing a middle-aged man eating noodles with chopsticks." },
    { id: 21, prompt: "A whimsical illustration of a curious cat peeking out from a cozy, woven basket." },
    { id: 22, prompt: "A surreal scene depicting a fluffy white rabbit sitting in the night sky, nibbling on the full moon." },
    { id: 23, prompt: "A high-speed video capturing the formation and fall of a liquid droplet from a faucet." },
    { id: 24, prompt: "A charming Japanese-style village nestled in a valley, surrounded by blooming cherry blossoms." },
    { id: 25, prompt: "A cinematic fantasy scene depicting a person walking through a field filled with floating lanterns." }
];

// Initialize video gallery
document.addEventListener('DOMContentLoaded', function() {
    const videoGrid = document.getElementById('videoGrid');
    const modal = document.getElementById('videoModal');
    const modalVideo = document.getElementById('modalVideo');
    const modalPrompt = document.getElementById('modalPrompt');
    const closeBtn = document.getElementsByClassName('close')[0];

    // Create video cards
    videoData.forEach(video => {
        const card = document.createElement('div');
        card.className = 'video-card';
        card.innerHTML = `
            <div class="video-thumbnail">
                <video src="videos/${video.id}.mp4" muted loop playsinline></video>
            </div>
            <div class="video-info">
                <div class="video-title">Sample ${video.id}</div>
                <div class="video-prompt">${video.prompt.substring(0, 60)}...</div>
            </div>
        `;

        // Auto-play on hover
        const videoElement = card.querySelector('video');
        card.addEventListener('mouseenter', () => {
            videoElement.play().catch(e => console.log('Autoplay prevented:', e));
        });
        card.addEventListener('mouseleave', () => {
            videoElement.pause();
            videoElement.currentTime = 0;
        });

        // Open modal on click
        card.addEventListener('click', () => {
            modal.style.display = 'block';
            modalVideo.src = `videos/${video.id}.mp4`;
            modalPrompt.textContent = video.prompt;
            modalVideo.play();
        });

        videoGrid.appendChild(card);
    });

    // Close modal
    closeBtn.onclick = function() {
        modal.style.display = 'none';
        modalVideo.pause();
        modalVideo.src = '';
    };

    // Close modal when clicking outside
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = 'none';
            modalVideo.pause();
            modalVideo.src = '';
        }
    };

    // Escape key to close modal
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && modal.style.display === 'block') {
            modal.style.display = 'none';
            modalVideo.pause();
            modalVideo.src = '';
        }
    });
});