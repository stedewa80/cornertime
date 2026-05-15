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
}

class App extends React.Component<{}, AppState> {
    fsm = new PunishmentStateMachine();
    settings = getSettings();
    diffy: any;
    videoContainerRef = React.createRef<HTMLDivElement>();

    state: AppState = {
        setupScreen: 'default',
    };

    componentDidMount() {
        this.fsm.addListener(this.handleFsmUpdate);

        // Debug globals
        if (typeof window !== 'undefined') {
            const anyWindow: any = window;
            anyWindow.cornertime = anyWindow.cornertime || {};
            anyWindow.cornertime.fsm = this.fsm;
        }

        if (process.env.NODE_ENV !== 'test') {
            this.diffy = create({
                ...this.settings.diffy,
                debug: true, // 1. CRITICAL: Force diffy to reveal the camera elements
                onFrame: matrix => this.handleMotionUpdate(matrix),
            });
        }
    }

    componentDidUpdate() {
        // 2. Since diffyjs appends elements to the <body>, we check if our active screen container exists,
        // and manually pull diffy's debug element into our container.
        if (this.videoContainerRef.current && this.videoContainerRef.current.children.length === 0) {
            // Diffy's default wrapper class name is 'diffy--debug-view'
            const diffyElement = document.querySelector('.diffy--debug-view');
            if (diffyElement) {
                this.videoContainerRef.current.appendChild(diffyElement);
            }
        }
    }

    componentWillUnmount() {
        this.fsm.removeListener(this.handleFsmUpdate);
    }

    render() {
        const fsm = this.fsm;

        const renderCamera = () => (
            <div 
                ref={this.videoContainerRef} 
                className="camera-container text-center my-4 d-flex justify-content-center"
            />
        );

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
