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
    sharedStream: MediaStream | null = null;

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

        // Initialize TensorFlow and Intercept Camera Stream for Front Facing Mode
        this.initAppSystems();
    }

    componentWillUnmount() {
        this.fsm.removeListener(this.handleFsmUpdate);
        this.stopDetectionAndTracks();
    }

    initAppSystems = async () => {
        // 1. Load the TensorFlow COCO-SSD script model globally
        const globalWindow = window as any;
        if (globalWindow.cocoSsd) {
            try {
                this.tfModel = await globalWindow.cocoSsd.load();
                console.log("TensorFlow loaded successfully!");
            } catch (err) {
                console.error("Failed to load TensorFlow model:", err);
            }
        }

        if (process.env.NODE_ENV === 'test') return;

        // 2. Intercept getUserMedia globally to force front camera on mobile devices
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        const self = this;

        navigator.mediaDevices.getUserMedia = async function(constraints) {
            const forcedConstraints = {
                audio: constraints ? constraints.audio : false,
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: "user" // Hard forces the selfie lens layout configuration
                }
            };

            // Capture the created stream reference so we can use it on the website
            const stream = await originalGetUserMedia(forcedConstraints);
            self.sharedStream = stream;
            
            // Re-bind the stream to our visual UI player frame if it's currently rendered
            self.bindStreamToUIVideo();

            return stream;
        };

        // 3. Let diffyjs initialize. It will call our intercepted getUserMedia and get the front camera
        try {
            this.diffy = create({
                ...this.settings.diffy,
                debug: false,
                onFrame: matrix => this.handleMotionUpdate(matrix),
            });
        } catch (e) {
            console.error("Diffy initialization exception:", e);
        }
    };

    // Safely binds the active stream to our custom on-screen player HTML tag
    bindStreamToUIVideo = () => {
        if (this.sharedStream && this.videoRef.current && !this.videoRef.current.srcObject) {
            this.videoRef.current.srcObject = this.sharedStream;
            
            this.videoRef.current.onloadedmetadata = () => {
                if (this.tfModel && !this.isDetectingLoopActive) {
                    this.isDetectingLoopActive = true;
                    this.runPersonDetection();
                }
            };
        }
    };

    stopDetectionAndTracks = () => {
        this.isDetectingLoopActive = false;
        if (this.sharedStream) {
            this.sharedStream.getTracks().forEach(track => track.stop());
            this.sharedStream = null;
        }
    };

    runPersonDetection = async () => {
        if (!this.isDetectingLoopActive || !this.videoRef.current || !this.tfModel) return;

        let detectedInThisFrame = false;

        try {
            // Confirm the player frame data has safely buffer loaded
            if (this.videoRef.current.readyState >= 2) {
                const predictions = await this.tfModel.detect(this.videoRef.current);
                detectedInThisFrame = predictions.some(
                    (p: any) => p.class === 'person' && p.score > 0.55
                );
            }
        } catch (e) {
            console.error("AI Detection computation error:", e);
        }

        if (detectedInThisFrame !== this.state.isPersonDetected) {
            this.setState({ isPersonDetected: detectedInThisFrame });
        }

        // Loop detection 4 times per second to maximize device battery efficiency
        if (this.isDetectingLoopActive) {
            setTimeout(() => this.runPersonDetection(), 250);
        }
    };

    render() {
        const fsm = this.fsm;

        const renderCamera = () => {
            // Trigger stream loading contextually when component updates layouts
            setTimeout(() => this.bindStreamToUIVideo(), 50);

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
