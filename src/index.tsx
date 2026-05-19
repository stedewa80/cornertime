import * as React from 'react';
import * as ReactDOM from 'react-dom';
import App from './components/App';
import './index.css';

// Function to inject script tags dynamically on startup
const loadTensorFlowScripts = () => {
    if (typeof document !== 'undefined') {
        // 1. Inject the core TensorFlow library
        const tfScript = document.createElement('script');
        tfScript.src = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs";
        tfScript.async = true;
        
        // 2. Inject the COCO-SSD object/person model AFTER the core loads
        tfScript.onload = () => {
            const cocoScript = document.createElement('script');
            cocoScript.src = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd";
            cocoScript.async = true;
            document.head.appendChild(cocoScript);
        };

        document.head.appendChild(tfScript);
    }
};

// Fire the script injector
loadTensorFlowScripts();

ReactDOM.render(
    <App />,
    document.getElementById('root') as HTMLElement
);
