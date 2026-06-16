import { useEffect, useRef, useState } from 'react';

const VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260611_104107_121bfb5a-b1df-4e0d-8240-25b81f7cc85d.mp4';

export function ScrollVideo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [framesReady, setFramesReady] = useState(false);
  
  const framesRef = useRef<ImageBitmap[]>([]);
  const progressRef = useRef({ target: 0, smoothed: 0 });
  const currentFrameIndexRef = useRef(-1);
  const rafIdRef = useRef<number>(0);
  
  const isSeekingRef = useRef(false);

  useEffect(() => {
    let isCancelled = false;
    let objectUrl = '';

    async function prepareFrames() {
      try {
        // Fetch as blob to bypass iOS CORS / canvas tainting issues
        const response = await fetch(VIDEO_URL);
        const blob = await response.blob();
        if (isCancelled) return;

        objectUrl = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true; // Required by iOS to load data sometimes
        video.src = objectUrl;
        video.load();

        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = reject;
        });

        if (isCancelled) return;

        const duration = video.duration || 5; // fallback duration if NaN
        const isMobile = window.innerWidth < 768;
        
        // Aggressive scaling for mobile memory limits
        const maxFrames = isMobile ? 45 : 120;
        const frameCount = Math.max(20, Math.min(maxFrames, Math.round(duration * 24)));
        
        const maxWidth = isMobile ? 480 : 1280;
        const scale = Math.min(1, maxWidth / video.videoWidth);
        const targetWidth = Math.round(video.videoWidth * scale);
        const targetHeight = Math.round(video.videoHeight * scale);

        const frames: ImageBitmap[] = [];

        // Pause video so it doesn't play while extracting
        video.pause();

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
              resizeQuality: 'low'
            });
            frames.push(bitmap);
          } catch (e) {
            // Safari fallback
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

      if (!framesReady) {
        // Fallback video scrubbing
        const video = videoRef.current;
        if (video && !Number.isNaN(video.duration) && !isSeekingRef.current) {
          const targetTime = progressRef.current.smoothed * video.duration;
          if (Math.abs(video.currentTime - targetTime) > 0.05) {
            isSeekingRef.current = true;
            video.currentTime = targetTime;
          }
        }
      } else {
        // Canvas frame rendering
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
  }, [framesReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    const handleSeeked = () => {
      isSeekingRef.current = false;
    };
    
    video.addEventListener('seeked', handleSeeked);
    return () => video.removeEventListener('seeked', handleSeeked);
  }, []);

  return (
    <div className="fixed inset-0 -z-10 bg-[#0a0a0a]">
      {!framesReady && (
        <video
          ref={videoRef}
          src={VIDEO_URL}
          muted
          playsInline
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full transition-opacity duration-1000 ${!framesReady ? 'opacity-0' : 'opacity-100'}`}
      />
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
}
