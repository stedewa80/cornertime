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
    isPersonDetected: boolean; // 1. Added State tracking for visibility
}

class App extends React.Component<{}, AppState> {
    fsm = new PunishmentStateMachine();
    settings = getSettings();
    diffy: any;
    
    // TensorFlow tracking variables
    tfModel: any = null;
    videoElement: HTMLVideoElement | null = null;
    isDetectingLoopActive: boolean = false; // Internal tracking loop controller

    state: AppState = {
        setupScreen: 'default',
        isPersonDetected: false, // Default to no one present
    };

    componentDidMount() {
        this.fsm.addListener(this.handleFsmUpdate);

        if (typeof window !== 'undefined') {
            const anyWindow: any = window;
            anyWindow.cornertime = anyWindow.cornertime || {};
            anyWindow.cornertime.fsm = this.fsm;
        }

        if (process.env.NODE_ENV !== 'test') {
            this.diffy = create({
                ...this.settings.diffy,
                debug: false,
                onFrame: matrix => this.handleMotionUpdate(matrix),
            });
        }

        this.initTensorFlow();
    }

    componentWillUnmount() {
        this.fsm.removeListener(this.handleFsmUpdate);
        this.isDetectingLoopActive = false; // Stop the detection loop on exit
    }

    initTensorFlow = async () => {
        const globalWindow = window as any;
        if (globalWindow.cocoSsd) {
            try {
                this.tfModel = await globalWindow.cocoSsd.load();
                console.log("TensorFlow COCO-SSD Model Loaded successfully!");
            } catch (err) {
                console.error("Failed to load TensorFlow model:", err);
            }
        }
    };

    attachCameraContainer = (node: HTMLDivElement | null) => {
        if (node && node.children.length === 0) {
            const video = document.querySelector('video');
            if (video) {
                node.appendChild(video);
                this.videoElement = video;
                
                // Start tracking if the model is ready and we aren't already looping
                if (this.tfModel && !this.isDetectingLoopActive) {
                    this.isDetectingLoopActive = true;
                    this.runPersonDetection();
                }
            }
        }
    };

    runPersonDetection = async () => {
        if (!this.isDetectingLoopActive || !this.videoElement || !this.tfModel) return;

        let detectedInThisFrame = false;

        try {
            // Ask TensorFlow to look at the current frame
            const predictions = await this.tfModel.detect(this.videoElement);
            
            // 2. Scan predictions specifically for 'person'
            detectedInThisFrame = predictions.some(
                (p: any) => p.class === 'person' && p.score > 0.6 // Adjust confidence if needed
            );

        } catch (e) {
            console.error("Detection error:", e);
        }

        // 3. Update React state if the visibility status changed (minimizes re-renders)
        if (detectedInThisFrame !== this.state.isPersonDetected) {
            this.setState({ isPersonDetected: detectedInThisFrame });
            // console.log(detectedInThisFrame ? "RED FRAME ACTIVE" : "GREEN FRAME ACTIVE");
        }

        // Mobile performance optimization: Scan every 250ms (4 times per second)
        if (this.isDetectingLoopActive) {
            setTimeout(() => this.runPersonDetection(), 250);
        }
    };

    render() {
        const fsm = this.fsm;

        // 4. Update helper: Generate classes based on state
        const renderCamera = () => {
            let containerClasses = "camera-container text-center my-4 d-flex justify-content-center";
            
            // Apply the activation class if a person is detected
            if (this.state.isPersonDetected) {
                containerClasses += " person-present";
            } else {
                containerClasses += " person-missing"; // Optional default style
            }

            return (
                <div 
                    ref={this.attachCameraContainer} 
                    className={containerClasses}
                />
            );
        };

        switch (fsm.state) {
            case 'waiting':
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
