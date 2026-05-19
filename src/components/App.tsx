import * as React from 'react';
import PunishmentStateMachine from '../state';
import getSettings from '../settings';
import WelcomeScreen from './WelcomeScreen';
import PunishmentSetup from './PunishmentSetup';
import PunishmentLoader from './PunishmentLoader';
import ReportCard from './ReportCard';
import ReportViewer from './ReportViewer';

import 'bootstrap/dist/css/bootstrap.css';
import { formatDuration } from '../time';

interface AppState {
    setupScreen: 'default' | 'custom' | 'report' | 'preset';
    isPersonDetected: boolean;
}

class App extends React.Component<{}, AppState> {
    fsm = new PunishmentStateMachine();
    settings = getSettings();
    
    videoRef = React.createRef<HTMLVideoElement>();
    tfModel: any = null;
    isLoopActive: boolean = false;
    stream: MediaStream | null = null;
    
    // Variablen für die native Bewegungserkennung im Hintergrund
    motionCanvas: HTMLCanvasElement | null = null;
    motionCtx: CanvasRenderingContext2D | null = null;
    oldPixelData: Uint8ClampedArray | null = null;

    state: AppState = {
        setupScreen: 'default',
        isPersonDetected: false,
    };

    componentDidMount() {
        this.fsm.addListener(this.handleFsmUpdate);

        if (typeof window !== 'undefined') {
            const anyWindow: any = window;
            anyWindow.cornertime = anyWindow.cornertime || {};
            anyWindow.cornertime.fsm = this.fsm;
        }

        // Startet das Laden von TensorFlow im Hintergrund
        this.loadTensorFlowModel();
    }

    componentWillUnmount() {
        this.fsm.removeListener(this.handleFsmUpdate);
        this.stopEverything();
    }

    loadTensorFlowModel = async () => {
        const globalWindow = window as any;
        if (globalWindow.cocoSsd) {
            try {
                this.tfModel = await globalWindow.cocoSsd.load();
                console.log("TensorFlow geladen!");
            } catch (err) {
                console.error("TensorFlow Fehler:", err);
            }
        }
    };

    startSystem = async () => {
        if (this.stream) return; // Läuft schon

        try {
            // Aktiviert die Frontkamera in guter Auflösung
            const constraints = { 
                video: { 
                    width: 640, 
                    height: 480,
                    facingMode: "user" 
                } 
            };
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            if (this.videoRef.current) {
                this.videoRef.current.srcObject = this.stream;
                
                this.videoRef.current.onloadedmetadata = () => {
                    // Erstellt ein unsichtbares Hilfs-Bild für die Bewegungserkennung
                    this.motionCanvas = document.createElement('canvas');
                    this.motionCanvas.width = 64; 
                    this.motionCanvas.height = 48;
                    this.motionCtx = this.motionCanvas.getContext('2d');

                    if (!this.isLoopActive) {
                        this.isLoopActive = true;
                        this.processingLoop();
                    }
                };
            }
        } catch (err) {
            console.error("Kamerafehler:", err);
        }
    };

    stopEverything = () => {
        this.isLoopActive = false;
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    };

    processingLoop = async () => {
        if (!this.isLoopActive || !this.videoRef.current) return;

        // --- TEIL 1: BEWEGUNGSERKENNUNG (Ersatz für Diffy) ---
        if (this.motionCtx && this.motionCanvas && this.videoRef.current.readyState >= 2) {
            const w = this.motionCanvas.width;
            const h = this.motionCanvas.height;

            // Zeichne das aktuelle Kamerabild ganz klein im Hintergrund
            this.motionCtx.drawImage(this.videoRef.current, 0, 0, w, h);
            const currentPixels = this.motionCtx.getImageData(0, 0, w, h).data;

            if (this.oldPixelData) {
                let changedPixels = 0;
                // Vergleiche die Pixel mit dem vorherigen Durchlauf
                for (let i = 0; i < currentPixels.length; i += 4) {
                    const diff = Math.abs(currentPixels[i] - this.oldPixelData[i]) + 
                                 Math.abs(currentPixels[i+1] - this.oldPixelData[i+1]) + 
                                 Math.abs(currentPixels[i+2] - this.oldPixelData[i+2]);
                    
                    if (diff > 50) { // Schwellenwert für Bewegung
                        changedPixels++;
                    }
                }
                const magnitude = changedPixels / (w * h);
                // Sendet den Bewegungswert direkt an die App-Logik
                this.fsm.handleMotionUpdate(magnitude);
            }
            this.oldPixelData = currentPixels;
        }

        // --- TEIL 2: PERSONENERKENNUNG (TensorFlow) ---
        if (this.tfModel && this.videoRef.current.readyState >= 2) {
            try {
                const predictions = await this.tfModel.detect(this.videoRef.current);
                const personFound = predictions.some(
                    (p: any) => (p.class === 'person' || p.class === 'face') && p.score > 0.40
                );

                if (personFound !== this.state.isPersonDetected) {
                    this.setState({ isPersonDetected: personFound });
                }
            } catch (e) {
                console.error("Klassifizierungsfehler:", e);
            }
        }

        // Wiederhole das Ganze 5-mal pro Sekunde (schont den Handy-Akku)
        if (this.isLoopActive) {
            setTimeout(() => this.processingLoop(), 200);
        }
    };

    render() {
        const fsm = this.fsm;

        const renderCamera = () => {
            this.startSystem(); // Aktiviert die Kamera automatisch

            let containerClasses = "camera-container text-center my-4 d-flex justify-content-center";
            if (this.state.isPersonDetected) {
                containerClasses += " person-present";
            } else {
                containerClasses += " person-missing";
            }

            return (
                <div className={containerClasses}>
                    <video ref={this.videoRef} autoPlay playsInline muted />
                </div>
            );
        };

        if (fsm.state === 'waiting') {
            if (this.isLoopActive) this.stopEverything();

            switch (this.state.setupScreen) {
                case 'custom':
                    return <PunishmentSetup fsm={fsm} onBack={this.returnToWelcomeScreen} />;
                case 'preset':
                    return <PunishmentLoader fsm={fsm} onBack={this.returnToWelcomeScreen} />;
                case 'report':
                    return <ReportViewer onBack={this.returnToWelcomeScreen} />;
                default:
                    return (
                        <WelcomeScreen
                            fsm={fsm}
                            onCustom={this.setUpCustom}
                            onPreset={this.loadPreset}
                            onReport={this.viewReport}
                        />
                    );
            }
        }

        switch (fsm.state) {
            case 'preparation':
                return (
                    <div className="container text-center">
                        <h1 className="display-2 my-5">
                            The punishment will start in {formatDuration(-fsm.currentTime)}.
                        </h1>
                        {renderCamera()}
                    </div>
                );

            case 'punishment':
            case 'cooldown':
                return (
                    <div className="container text-center">
                        <h1 className="display-1 my-5">{formatDuration(fsm.timeLeft)}</h1>
                        {renderCamera()}
                    </div>
                );

            case 'finished':
                if (this.isLoopActive) this.stopEverything();
                return <ReportCard report={fsm.report()} showMessage={true} />;

            default:
                return null;
        }
    }

    setUpCustom = () => this.setState({ setupScreen: 'custom' });
    viewReport = () => this.setState({ setupScreen: 'report' });
    loadPreset = () => this.setState({ setupScreen: 'preset' });
    returnToWelcomeScreen = () => this.setState({ setupScreen: 'default' });

    handleFsmUpdate = () => {
        this.forceUpdate();
    }
}

export default App;
