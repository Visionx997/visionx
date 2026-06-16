import { useEffect, useRef, useState } from 'react';

const VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260611_104107_121bfb5a-b1df-4e0d-8240-25b81f7cc85d.mp4';

export function ScrollVideo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [isMobile, setIsMobile] = useState(false);
  const [framesReady, setFramesReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  
  const framesRef = useRef<ImageBitmap[]>([]);
  const progressRef = useRef({ target: 0, smoothed: 0 });
  const currentFrameIndexRef = useRef(-1);
  const rafIdRef = useRef<number>(0);
  const isSeekingRef = useRef(false);

  useEffect(() => {
    // Detect mobile by checking innerWidth
    const mobile = window.innerWidth < 768;
    setIsMobile(mobile);

    // Skip heavy Canvas extraction entirely on mobile devices
    if (mobile) return;

    let isCancelled = false;
    let objectUrl = '';

    async function prepareFrames() {
      try {
        const response = await fetch(VIDEO_URL);
        const blob = await response.blob();
        if (isCancelled) return;

        objectUrl = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.src = objectUrl;
        video.load();

        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = reject;
        });

        if (isCancelled) return;

        const duration = video.duration || 5;
        const frameCount = Math.max(30, Math.min(120, Math.round(duration * 24)));
        const scale = Math.min(1, 1280 / video.videoWidth);
        const targetWidth = Math.round(video.videoWidth * scale);
        const targetHeight = Math.round(video.videoHeight * scale);

        const frames: ImageBitmap[] = [];

        for (let i = 0; i < frameCount; i++) {
          if (isCancelled) break;
          const time = (i / (frameCount - 1)) * (duration - 0.05);
          video.currentTime = time;
          
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              resolve();
            };
            video.addEventListener('seeked', onSeeked);
          });

          if (isCancelled) break;

          try {
            const bitmap = await createImageBitmap(video, {
              resizeWidth: targetWidth,
              resizeHeight: targetHeight,
              resizeQuality: 'high'
            });
            frames.push(bitmap);
          } catch (e) {
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(video, 0, 0, targetWidth, targetHeight);
            const bitmap = await createImageBitmap(canvas);
            frames.push(bitmap);
          }
        }

        if (!isCancelled) {
          framesRef.current = frames;
          setFramesReady(true);
        } else {
          frames.forEach(f => f.close());
        }
      } catch (err) {
        console.error('Failed to extract frames', err);
      }
    }

    prepareFrames();

    return () => {
      isCancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      framesRef.current.forEach(f => f.close());
      framesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const maxScroll = document.body.scrollHeight - window.innerHeight;
      const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
      progressRef.current.target = Math.max(0, Math.min(1, progress));
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const renderLoop = () => {
      const { target, smoothed } = progressRef.current;
      progressRef.current.smoothed += (target - smoothed) * 0.1;

      // Use video element scrubbing on mobile or as a fallback on desktop
      if (isMobile || !framesReady) {
        const video = videoRef.current;
        // MUST check readyState >= 2 (HAVE_CURRENT_DATA) to avoid iOS freezing
        if (video && video.readyState >= 2 && !Number.isNaN(video.duration) && !isSeekingRef.current) {
          const targetTime = progressRef.current.smoothed * video.duration;
          
          if (Math.abs(video.currentTime - targetTime) > 0.05) {
            isSeekingRef.current = true;
            video.currentTime = targetTime;
          }
        }
      } else {
        // Desktop: Canvas Frame Rendering
        const frames = framesRef.current;
        if (frames.length > 0 && canvasRef.current) {
          const frameIndex = Math.min(
            frames.length - 1,
            Math.max(0, Math.round(progressRef.current.smoothed * (frames.length - 1)))
          );

          if (frameIndex !== currentFrameIndexRef.current) {
            currentFrameIndexRef.current = frameIndex;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            const frame = frames[frameIndex];

            if (ctx && frame) {
              const dpr = Math.min(2, window.devicePixelRatio || 1);
              const rect = canvas.getBoundingClientRect();
              
              if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
                canvas.width = Math.floor(rect.width * dpr);
                canvas.height = Math.floor(rect.height * dpr);
              }

              const scale = Math.max(canvas.width / frame.width, canvas.height / frame.height);
              const drawWidth = frame.width * scale;
              const drawHeight = frame.height * scale;
              const offsetX = (canvas.width - drawWidth) / 2;
              const offsetY = (canvas.height - drawHeight) / 2;

              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(frame, offsetX, offsetY, drawWidth, drawHeight);
            }
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(renderLoop);
    };

    rafIdRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafIdRef.current);
  }, [framesReady, isMobile]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    const handleSeeked = () => { isSeekingRef.current = false; };
    const handleCanPlay = () => { setVideoReady(true); };
    
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('loadeddata', handleCanPlay);
    
    // On iOS, sometimes the video won't even load its metadata or first frame 
    // unless we explicitly call load() or play() then immediately pause().
    // We try to fetch the first frame by attempting to play it.
    video.load();
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        // Immediately pause so we can scrub it instead
        video.pause();
        setVideoReady(true);
      }).catch(() => {
        // Autoplay might be blocked, but we've triggered the load
        setVideoReady(true);
      });
    }

    return () => {
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('loadeddata', handleCanPlay);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 bg-[#0a0a0a]">
      {/* Show video tag if mobile OR if desktop frames aren't ready yet */}
      {(isMobile || !framesReady) && (
        <video
          ref={videoRef}
          src={VIDEO_URL}
          muted
          playsInline
          autoPlay
          preload="auto"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${videoReady ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {!isMobile && (
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full transition-opacity duration-1000 ${!framesReady ? 'opacity-0' : 'opacity-100'}`}
        />
      )}
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
}
