// Video data with prompts and titles
const videoData = [
    { id: 1, title: "Desert Rider", prompt: "A cinematic scene from a classic western movie, featuring a rugged man riding a powerful horse through the vast Gobi Desert at sunset." },
    { id: 2, title: "Urban Tsunami", prompt: "A dramatic and dynamic scene depicting a powerful tsunami rushing through a narrow alley in Bulgaria." },
    { id: 3, title: "Tokyo Pig Chase", prompt: "A vibrant anime illustration of a pink pig running rapidly towards the camera in a narrow alley in Tokyo." },
    { id: 4, title: "Vintage Drag Race", prompt: "A vintage drag racing scene featuring six muscle cars lined up at the starting line." },
    { id: 5, title: "Lava Flow", prompt: "A mesmerizing video capturing the slow flow of molten lava down the side of a dormant volcano." },
    { id: 6, title: "Martini Pour", prompt: "A slow-motion video capturing the intricate process of pouring a drink into a classic martini glass." },
    { id: 7, title: "Mammoth Migration", prompt: "A stunning mid-afternoon landscape photograph showcasing giant wooly mammoths treading through a snowy meadow." },
    { id: 8, title: "Rainstorm Close-up", prompt: "A dramatic close-up of a rainstorm, capturing the intense droplets of rain hitting various surfaces." },
    { id: 9, title: "Big Sur Waves", prompt: "A drone view of waves crashing against the rugged cliffs along Big Sur's Garay Point beach." },
    { id: 10, title: "Floral Orchestra", prompt: "A vibrant illustration depicting a person conducting an orchestra of flowers." },
    { id: 11, title: "Panoramic Wonder", prompt: "A realistic photograph capturing a young woman with wide-eyed astonishment at a stunning panoramic view." },
    { id: 13, title: "Wool to Cat", prompt: "A whimsical, hand-drawn illustration depicting a ball of wool transforming into a cute, fluffy cat." },
    { id: 15, title: "Ink Diffusion", prompt: "A slow-motion video depicting the gradual injection of ink into a tank of water." },
    { id: 17, title: "Beach Corgi", prompt: "A tropical island beach scene featuring a corgi wearing stylish sunglasses walking along the sandy shore." },
    { id: 18, title: "Rock Man", prompt: "A full-body shot of a man crafted entirely from rocks, walking through a dense forest." },
    { id: 19, title: "Contemplative Driver", prompt: "A close-up shot of a young woman driving a car, lost in thought as she gazes ahead." },
    { id: 20, title: "Noodle Dining", prompt: "A traditional Chinese dining scene capturing a middle-aged man eating noodles with chopsticks." },
    { id: 21, title: "Curious Cat", prompt: "A whimsical illustration of a curious cat peeking out from a cozy, woven basket." },
    { id: 23, title: "Water Droplet", prompt: "A high-speed video capturing the formation and fall of a liquid droplet from a faucet." },
    { id: 24, title: "Cherry Blossom Village", prompt: "A charming Japanese-style village nestled in a valley, surrounded by blooming cherry blossoms." },
    { id: 25, title: "Lantern Field", prompt: "A cinematic fantasy scene depicting a person walking through a field filled with floating lanterns." }
];

// Initialize video gallery
document.addEventListener('DOMContentLoaded', function() {
    const videoGrid = document.getElementById('videoGrid');
    const modal = document.getElementById('videoModal');
    const modalVideo = document.getElementById('modalVideo');
    const modalPrompt = document.getElementById('modalPrompt');
    const closeBtn = document.getElementsByClassName('close')[0];

    // Create video cards
    const videoElements = [];

    videoData.forEach(video => {
        const card = document.createElement('div');
        card.className = 'video-card';
        card.innerHTML = `
            <div class="video-thumbnail">
                <video src="videos/${video.id}.mp4" muted loop playsinline autoplay></video>
            </div>
            <div class="video-info">
                <div class="video-title">${video.title}</div>
                <div class="video-prompt">${video.prompt.substring(0, 60)}...</div>
            </div>
        `;

        const videoElement = card.querySelector('video');
        videoElements.push(videoElement);

        // Open modal on click
        card.addEventListener('click', () => {
            modal.style.display = 'block';
            modalVideo.src = `videos/${video.id}.mp4`;
            modalPrompt.textContent = video.prompt;
            modalVideo.play();
        });

        videoGrid.appendChild(card);
    });

    // Start all videos playing with intersection observer for performance
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.play().catch(e => {
                    console.log('Autoplay prevented:', e);
                });
            }
        });
    }, { threshold: 0.1 });

    videoElements.forEach(video => {
        observer.observe(video);
        // Also try to play immediately
        video.play().catch(e => console.log('Initial autoplay prevented'))
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