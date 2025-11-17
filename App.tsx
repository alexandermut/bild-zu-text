
import React, { useState, useEffect, useRef, useCallback } from 'react';

// Type definitions for Tesseract.js loaded from CDN
declare global {
  const Tesseract: {
    createWorker(
      options?: Partial<Tesseract.WorkerOptions>
    ): Promise<Tesseract.Worker>;
  };

  namespace Tesseract {
    type ImageLike = string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | File | Blob | ImageData;

    interface Worker {
      load(): Promise<void>;
      loadLanguage(langs: string | string[]): Promise<void>;
      initialize(langs: string | string[]): Promise<void>;
      recognize(image: ImageLike): Promise<RecognizeResult>;
      terminate(): Promise<void>;
    }
    
    interface RecognizeResult {
      data: {
        text: string;
      };
    }
    
    interface WorkerOptions {
      logger?: (m: LoggerMessage) => void;
    }
    
    interface LoggerMessage {
        status: string;
        progress: number;
        jobId: string;
    }
  }
}

type Stage = 'idle' | 'initializing' | 'recognizing' | 'done';

// --- Helper Icon Components (defined outside App to prevent re-renders) ---

const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

const CameraIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);

const PasteIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
    </svg>
);

const CopyIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const ResetIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 4l16 16" />
    </svg>
);


// --- Progress Bar Component ---
interface ProgressBarProps {
    progress: number;
    status: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ progress, status }) => (
    <div className="w-full text-center">
        <div className="w-full bg-gray-600 rounded-full h-2.5 mb-2 overflow-hidden">
            <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress * 100}%` }}
            ></div>
        </div>
        <p className="text-sm text-slate-300 capitalize">{status.replace(/_/g, ' ')}...</p>
    </div>
);


// --- Main App Component ---

export default function App() {
    const [image, setImage] = useState<string | null>(null);
    const [text, setText] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [stage, setStage] = useState<Stage>('idle');
    const [progress, setProgress] = useState({ status: '', progress: 0 });
    const [workerReady, setWorkerReady] = useState<boolean>(false);
    const [copyButtonText, setCopyButtonText] = useState<string>('Kopieren');
    
    const workerRef = useRef<Tesseract.Worker | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const updateProgress = useCallback((m: Tesseract.LoggerMessage) => {
        setProgress({ status: m.status, progress: m.progress });
    }, []);

    useEffect(() => {
        const initializeWorker = async () => {
            setStage('initializing');
            try {
                const worker = await Tesseract.createWorker({
                    logger: updateProgress,
                });
                await worker.loadLanguage('deu');
                await worker.initialize('deu');
                workerRef.current = worker;
                setWorkerReady(true);
                setStage('idle');
            } catch (err) {
                setError('Tesseract.js konnte nicht initialisiert werden. Bitte laden Sie die Seite neu.');
                setStage('idle');
            }
        };
        initializeWorker();

        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    
    const processImage = async (imageFile: File | Blob) => {
        if (!workerRef.current) return;
        
        setError(null);
        setText('');
        setStage('recognizing');
        
        // Revoke previous object URL if it exists to prevent memory leaks
        if (image) {
            URL.revokeObjectURL(image);
        }
        
        const imageUrl = URL.createObjectURL(imageFile);
        setImage(imageUrl);

        try {
            const { data } = await workerRef.current.recognize(imageFile);
            setText(data.text);
            setStage('done');
        } catch (err) {
            setError('Fehler bei der Texterkennung. Versuchen Sie es mit einem anderen Bild.');
            setStage('idle');
        }
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            processImage(file);
        }
    };

    const handlePaste = async () => {
        if (!navigator.clipboard?.read) {
            setError("Die Zwischenablage-API wird von Ihrem Browser nicht unterstützt.");
            return;
        }

        try {
            const clipboardItems = await navigator.clipboard.read();
            let imageBlob: Blob | null = null;

            for (const item of clipboardItems) {
                const imageType = item.types.find(type => type.startsWith('image/'));
                if (imageType) {
                    imageBlob = await item.getType(imageType);
                    break; 
                }
            }

            if (imageBlob) {
                await processImage(imageBlob);
            } else {
                setError("Kein Bild in der Zwischenablage gefunden.");
            }
        } catch (err) {
            if (err instanceof Error && err.name === 'NotAllowedError') {
                 setError("Zugriff auf die Zwischenablage wurde verweigert.");
            } else {
                 setError("Fehler beim Einfügen aus der Zwischenablage.");
            }
        }
    };

    const handleReset = () => {
        if (image) {
            URL.revokeObjectURL(image);
        }
        setImage(null);
        setText('');
        setError(null);
        setStage('idle');
        setProgress({ status: '', progress: 0 });
        if(inputRef.current) {
            inputRef.current.value = '';
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopyButtonText('Kopiert!');
        setTimeout(() => setCopyButtonText('Kopieren'), 2000);
    };
    
    const triggerFileUpload = (capture: boolean) => {
        if (inputRef.current) {
            if (capture) {
                inputRef.current.setAttribute('capture', 'environment');
            } else {
                inputRef.current.removeAttribute('capture');
            }
            inputRef.current.click();
        }
    };

    const isProcessing = stage === 'initializing' || stage === 'recognizing';
    
    return (
        <div className="min-h-screen flex flex-col p-4 font-sans text-slate-200">
            <main className="flex-grow flex items-center justify-center">
                <div className="w-full max-w-2xl bg-gray-800 rounded-2xl shadow-2xl p-6 md:p-8 space-y-6">
                    <header className="text-center">
                        <h1 className="text-3xl font-bold text-white">Bild-zu-Text OCR</h1>
                        <p className="text-slate-400 mt-1">Text aus Bildern extrahieren mit Tesseract.js</p>
                    </header>

                    <div className="space-y-4">
                        {stage !== 'done' && !text && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <button
                                    onClick={() => triggerFileUpload(false)}
                                    disabled={!workerReady || isProcessing}
                                    className="flex items-center justify-center w-full px-4 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                                >
                                    <UploadIcon/>
                                    Hochladen
                                </button>
                                <button
                                    onClick={() => triggerFileUpload(true)}
                                    disabled={!workerReady || isProcessing}
                                    className="flex items-center justify-center w-full px-4 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                                >
                                    <CameraIcon/>
                                    Aufnehmen
                                </button>
                                <button
                                    onClick={handlePaste}
                                    disabled={!workerReady || isProcessing}
                                    className="flex items-center justify-center w-full px-4 py-3 bg-purple-600 text-white font-semibold rounded-xl hover:bg-purple-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                                >
                                    <PasteIcon />
                                    Einfügen
                                </button>
                                <input
                                    type="file"
                                    accept="image/*"
                                    ref={inputRef}
                                    onChange={handleFileSelect}
                                    className="hidden"
                                />
                            </div>
                        )}
                        
                        {isProcessing && <ProgressBar progress={progress.progress} status={progress.status} />}
                        
                        {error && (
                            <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-xl text-center">
                                <p>{error}</p>
                            </div>
                        )}

                        {image && (
                             <div className="bg-gray-900 p-2 rounded-xl">
                                <img src={image} alt="Vorschau" className="max-h-60 w-auto mx-auto rounded-lg" />
                            </div>
                        )}

                        {text && (
                            <div className="space-y-4">
                                <textarea
                                    value={text}
                                    readOnly
                                    className="w-full h-48 p-4 bg-gray-900 border border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-200"
                                    placeholder="Erkannter Text..."
                                />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <button
                                        onClick={handleCopy}
                                        className="flex items-center justify-center px-4 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                                    >
                                        <CopyIcon />
                                        {copyButtonText}
                                    </button>
                                    <button
                                        onClick={handleReset}
                                        className="flex items-center justify-center px-4 py-3 bg-gray-600 text-white font-semibold rounded-xl hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                                    >
                                        <ResetIcon />
                                        Zurücksetzen
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>
            <footer className="flex-shrink-0 text-center py-4 text-slate-500 text-sm">
                <a href="https://alexandermut.github.io/kontaktdaten_vcard_alexander_mut/impressum.html" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors mx-2">
                    Impressum
                </a>
                <span className="text-slate-600">|</span>
                <a href="https://alexandermut.github.io/kontaktdaten_vcard_alexander_mut/datenschutz.html" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors mx-2">
                    Datenschutz
                </a>
            </footer>
        </div>
    );
}
