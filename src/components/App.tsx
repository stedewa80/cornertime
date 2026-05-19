import * as React from 'react';
import PunishmentStateMachine from '../state';
import getSettings from '../settings';
import { create } from 'diffyjs';
import WelcomeScreen from './WelcomeScreen';
import PunishmentSetup from './PunishmentSetup';
import PunishmentLoader from './PunishmentLoader';
import ReportCard from './ReportCard';
import ReportViewer from './ReportViewer';

import 'bootstrap/dist/css/bootstrap.css';
import { formatDuration } from '../time';

const MOTION_MAX = 255;
type SetupScreen = 'default' | 'custom' | 'report' | 'preset';

interface AppState {
    setupScreen: SetupScreen;
    isPersonDetected: boolean;
}

class App extends React.Component<{}, AppState> {
    fsm = new PunishmentStateMachine();
    settings = getSettings();
    diffy: any;
    
    videoRef = React.createRef<HTMLVideoElement>();
    tfModel: any = null;
    isDetectingLoopActive: boolean = false;
    stream: MediaStream | null = null;

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

        // 1. Kickstart the secure front camera selection first before initializing diffyjs
        this.initCameraAndLibraries();
    }

    componentWillUnmount() {
        this.fsm.removeListener(this.handleFsmUpdate);
        this.stopWebcamAndDetection();
    }

    initCameraAndLibraries = async () => {
        // Load TensorFlow globally
        const globalWindow = window as any;
        if (globalWindow.cocoSsd) {
            try {
                this.tfModel = await globalWindow.cocoSsd.load();
                console.log("TensorFlow COCO-SSD loaded!");
            } catch (err) {
                console.error("Failed to load TensorFlow model:", err);
            }
        }

        // 2. Explicitly spin up the front camera stream immediately
        try {
            const constraints = { 
                video: { 
                    width: 640, 
                    height: 480,
                    facingMode: { exact: "user" } // Force mobile browser to pick front camera
                } 
            };
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Link our managed front camera stream to diffyjs settings
            if (process.env.NODE_ENV !== 'test') {
                this.diffy = create({
                    ...this.settings.diffy,
                    debug: false,
                    stream: this.stream, // Pass our direct front-facing stream into diffyjs
                    onFrame: matrix => this.handleMotionUpdate(matrix),
                });
            }
        } catch (err) {
            console.error("Front camera initialization failed, trying fallback:", err);
            // Relaxed string fallback if hardware constraints are strict on certain phone browsers
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
                if (process.env.NODE_ENV !== 'test') {
                    this.diffy = create({
                        ...this.settings.diffy,
                        debug: false,
                        stream: this.stream,
                        onFrame: matrix => this.handleMotionUpdate(matrix),
                    });
                }
            } catch (fallbackErr) {
                console.error("Complete camera capture failure:", fallbackErr);
            }
        }
    };

    // Safely links the stream to our visual HTML player when transitioning onto punishment layouts
    bindStreamToVideoTag = () => {
        if (this.stream && this.videoRef.current && !this.videoRef.current.srcObject) {
            this.videoRef.current.srcObject = this.stream;
            
            this.videoRef.current.onloadedmetadata = () => {
                if (this.tfModel && !this.isDetectingLoopActive) {
                    this.isDetectingLoopActive = true;
                    this.runPersonDetection();
                }
            };
        }
    };

    stopWebcamAndDetection = () => {
        this.isDetectingLoopActive = false;
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    };

    runPersonDetection = async () => {
        if (!this.isDetectingLoopActive || !this.videoRef.current || !this.tfModel) return;

        let detectedInThisFrame = false;

        try {
            if (this.videoRef.current.readyState >= 2) {
                const predictions = await this.tfModel.detect(this.videoRef.current);
                detectedInThisFrame = predictions.some(
                    (p: any) => p.class === 'person' && p.score > 0.55
                );
            }
        } catch (e) {
            console.error("AI Detection error:", e);
        }

        if (detectedInThisFrame !== this.state.isPersonDetected) {
            this.setState({ isPersonDetected: detectedInThisFrame });
        }

        if (this.isDetectingLoopActive) {
            setTimeout(() => this.runPersonDetection(), 250);
        }
    };

    render() {
        const fsm = this.fsm;

        const renderCamera = () => {
            // Trigger stream loading to player interface safely on mount
            setTimeout(() => this.bindStreamToVideoTag(), 50);

            let containerClasses = "camera-container text-center my-4 d-flex justify-content-center";
            if (this.state.isPersonDetected) {
                containerClasses += " person-present";
            } else {
                containerClasses += " person-missing";
            }

            return (
                <div className={containerClasses}>
                    <video 
                        ref={this.videoRef} 
                        autoPlay 
                        playsInline 
                        muted 
                    />
                </div>
            );
        };

        if (fsm.state === 'waiting') {
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

    handleMotionUpdate = (matrix: number[][]) => {
        const minValue = Math.min(...matrix.map(row => Math.min(...row)));
        const magnitude = (MOTION_MAX - minValue) / MOTION_MAX;
        this.fsm.handleMotionUpdate(magnitude);
    }
}

export default App;
