/**
 * BPM detector using beat tracking with onset detection
 * Also detects "still" periods (low bass energy) that can be stitched together
 */

export class BPMDetector {
    private beatTimes: number[] = [];
    private lastBeatTime: number = 0;
    private readonly bpmHistory: number[] = [];
    private readonly minBeatInterval = 300; // Minimum 200 BPM (60000ms / 200 = 300ms)
    private readonly maxBeatInterval = 1200; // Maximum 50 BPM (60000ms / 50 = 1200ms)
    private readonly historySize = 20; // Number of intervals to track
    private detectedBPM: number | null = null;
    private confidenceThreshold = 0.7; // How consistent beats need to be

    // Still period detection
    private stillStartTime: number | null = null;
    private stillPeriods: { start: number; end: number; duration: number }[] = [];
    private isCurrentlyStill: boolean = false;
    private readonly stillThreshold = 0.2; // Below this energy = "still"
    private readonly minStillDuration = 500; // Minimum 500ms to count as a still period
    private lastDropTime: number = 0;
    private readonly minDropInterval = 1000; // Minimum 1s between detected drops

    // Beat onset detection (rising edge)
    private previousBassEnergy: number = 0;
    private risingEdgeStartTime: number | null = null;
    private risingEdgeStartEnergy: number = 0;
    private readonly onsetThreshold = 0.3; // Energy must rise by this much to count as onset
    private readonly analysisLatency = 50; // Approximate latency compensation in ms

    // Phase tracking for beat matching
    private lastOnsetTime: number = 0;
    private beatInterval: number = 0; // Estimated ms between beats

    // Transient detection (distinguishes beats from sustained energy)
    private energyHistory: number[] = [];
    private readonly energyHistorySize = 10; // ~166ms at 60fps
    private readonly transientRatio = 1.8; // Current energy must be this much higher than recent average

    /**
     * Check if current energy represents a transient (sudden spike) vs sustained energy
     * This distinguishes actual beats from melodic bass lines
     */
    private isTransient(currentEnergy: number): boolean {
        if (this.energyHistory.length < 3) return false;
        
        // Calculate recent average (excluding the last couple frames which might be part of the transient)
        const historyToCheck = this.energyHistory.slice(0, -2);
        if (historyToCheck.length === 0) return false;
        
        const recentAvg = historyToCheck.reduce((a, b) => a + b, 0) / historyToCheck.length;
        
        // A transient should be significantly higher than the recent average
        // and the recent average should be relatively low (not sustained high energy)
        return currentEnergy > recentAvg * this.transientRatio && recentAvg < 0.5;
    }

    /**
     * Call this on every frame with the current bass energy
     * @param bassEnergy - Current bass energy (0-1)
     * @param threshold - Energy threshold to consider a beat (default 0.6)
     * @returns true if a "drop" was just detected (transition from still to beat)
     */
    public detectBeat(bassEnergy: number, threshold: number = 0.6): boolean {
        const now = performance.now();
        let dropDetected = false;

        // Update energy history for transient detection
        this.energyHistory.push(bassEnergy);
        if (this.energyHistory.length > this.energyHistorySize) {
            this.energyHistory.shift();
        }

        // Check if this is a transient (actual beat) not sustained energy
        const isTransientBeat = this.isTransient(bassEnergy);

        // Detect beat onset (rising edge) - more accurate than peak detection
        const energyDelta = bassEnergy - this.previousBassEnergy;
        
        if (energyDelta > 0.05 && this.risingEdgeStartTime === null) {
            // Start of a rising edge
            this.risingEdgeStartTime = now;
            this.risingEdgeStartEnergy = this.previousBassEnergy;
        } else if (energyDelta <= 0 && this.risingEdgeStartTime !== null) {
            // End of rising edge - check if it was significant AND a transient
            const totalRise = bassEnergy - this.risingEdgeStartEnergy;
            if (totalRise >= this.onsetThreshold && bassEnergy > threshold && isTransientBeat) {
                // This was a beat onset! The actual beat started at risingEdgeStartTime
                const onsetTime = this.risingEdgeStartTime - this.analysisLatency;
                
                if ((onsetTime - this.lastOnsetTime) > this.minBeatInterval) {
                    // Calculate beat interval for phase prediction
                    if (this.lastOnsetTime > 0) {
                        const interval = onsetTime - this.lastOnsetTime;
                        if (interval >= this.minBeatInterval && interval <= this.maxBeatInterval) {
                            // Smooth the beat interval estimate
                            this.beatInterval = this.beatInterval === 0 
                                ? interval 
                                : this.beatInterval * 0.7 + interval * 0.3;
                        }
                    }
                    this.lastOnsetTime = onsetTime;
                }
            }
            this.risingEdgeStartTime = null;
        }

        // Track still periods (low bass energy)
        if (bassEnergy < this.stillThreshold) {
            if (!this.isCurrentlyStill) {
                // Just entered a still period
                this.stillStartTime = now;
                this.isCurrentlyStill = true;
            }
        } else if (this.isCurrentlyStill) {
            // Exiting a still period
            if (this.stillStartTime !== null) {
                const duration = now - this.stillStartTime;
                if (duration >= this.minStillDuration) {
                    this.stillPeriods.push({
                        start: this.stillStartTime,
                        end: now,
                        duration
                    });
                    // Keep only recent still periods
                    if (this.stillPeriods.length > 10) {
                        this.stillPeriods.shift();
                    }
                    
                    // Check if this is a "drop" (still period followed by high energy)
                    if (bassEnergy > threshold && (now - this.lastDropTime) > this.minDropInterval) {
                        dropDetected = true;
                        this.lastDropTime = now;
                    }
                }
            }
            this.stillStartTime = null;
            this.isCurrentlyStill = false;
        }

        // Check if this is a beat (high bass energy + enough time since last beat)
        if (bassEnergy > threshold && (now - this.lastBeatTime) > this.minBeatInterval) {
            this.beatTimes.push(now);
            this.lastBeatTime = now;

            // Keep only recent beats
            if (this.beatTimes.length > this.historySize + 1) {
                this.beatTimes.shift();
            }

            // Need at least 4 beats to calculate BPM
            if (this.beatTimes.length >= 4) {
                this.calculateBPM();
            }
        }

        this.previousBassEnergy = bassEnergy;
        return dropDetected;
    }

    /**
     * Get the time until the next predicted beat
     * @returns milliseconds until next beat, or 0 if we can't predict
     */
    public getTimeToNextBeat(): number {
        if (this.beatInterval === 0 || this.lastOnsetTime === 0) return 0;
        
        const now = performance.now();
        const timeSinceLastOnset = now - this.lastOnsetTime;
        const phaseInBeat = timeSinceLastOnset % this.beatInterval;
        return this.beatInterval - phaseInBeat;
    }

    /**
     * Get the current phase within the beat cycle (0-1)
     * 0 = just after a beat, 1 = just before next beat
     */
    public getBeatPhase(): number {
        if (this.beatInterval === 0 || this.lastOnsetTime === 0) return 0;
        
        const now = performance.now();
        const timeSinceLastOnset = now - this.lastOnsetTime;
        return (timeSinceLastOnset % this.beatInterval) / this.beatInterval;
    }

    /**
     * Get the estimated beat interval in milliseconds
     */
    public getBeatInterval(): number {
        return this.beatInterval;
    }

    private calculateBPM(): void {
        if (this.beatTimes.length < 2) return;

        // Calculate intervals between consecutive beats
        const intervals: number[] = [];
        for (let i = 1; i < this.beatTimes.length; i++) {
            const interval = this.beatTimes[i] - this.beatTimes[i - 1];

            // Filter out unrealistic intervals
            if (interval >= this.minBeatInterval && interval <= this.maxBeatInterval) {
                intervals.push(interval);
            }
        }

        if (intervals.length < 3) return;

        // Calculate median interval (more robust than mean)
        const sortedIntervals = [...intervals].sort((a, b) => a - b);
        const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)];

        // Convert to BPM
        const bpm = Math.round(60000 / medianInterval);

        // Check confidence (how consistent are the intervals?)
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / intervals.length;
        const stdDev = Math.sqrt(variance);
        const coefficientOfVariation = stdDev / mean;

        // Only accept if beats are reasonably consistent
        if (coefficientOfVariation < this.confidenceThreshold) {
            this.bpmHistory.push(bpm);

            // Keep history size limited
            if (this.bpmHistory.length > 10) {
                this.bpmHistory.shift();
            }

            // Update detected BPM (average of recent detections)
            this.detectedBPM = Math.round(
                this.bpmHistory.reduce((a, b) => a + b, 0) / this.bpmHistory.length
            );
        }
    }

    /**
     * Get the currently detected BPM
     * @returns Detected BPM or null if not enough data
     */
    public getBPM(): number | null {
        return this.detectedBPM;
    }

    /**
     * Get confidence level (0-1) based on number of beats detected
     */
    public getConfidence(): number {
        if (this.beatTimes.length < 4) return 0;
        return Math.min(1, this.beatTimes.length / this.historySize);
    }

    /**
     * Reset the detector (call when switching tracks)
     */
    public reset(): void {
        this.beatTimes = [];
        this.lastBeatTime = 0;
        this.bpmHistory.length = 0;
        this.detectedBPM = null;
        // Reset still period tracking
        this.stillStartTime = null;
        this.stillPeriods = [];
        this.isCurrentlyStill = false;
        this.lastDropTime = 0;
        // Reset onset detection
        this.previousBassEnergy = 0;
        this.risingEdgeStartTime = null;
        this.risingEdgeStartEnergy = 0;
        this.lastOnsetTime = 0;
        this.beatInterval = 0;
        // Reset transient detection
        this.energyHistory = [];
    }

    /**
     * Check if the given energy level is a transient beat (punch) vs sustained energy
     * Use this to avoid transitioning during melodic sections
     */
    public isTransientBeat(bassEnergy: number, threshold: number = 0.6): boolean {
        return bassEnergy > threshold && this.isTransient(bassEnergy);
    }

    /**
     * Get the recent average bass energy (useful for detecting sustained vs dynamic sections)
     */
    public getRecentAverageEnergy(): number {
        if (this.energyHistory.length === 0) return 0;
        return this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    }

    /**
     * Check if we have a reliable BPM detection
     */
    public hasReliableBPM(): boolean {
        return this.detectedBPM !== null && this.getConfidence() > 0.5;
    }

    /**
     * Check if we're currently in a still (low energy) period
     */
    public isInStillPeriod(): boolean {
        return this.isCurrentlyStill;
    }

    /**
     * Get the current still period duration (if in a still period)
     * @returns Duration in ms, or 0 if not in a still period
     */
    public getCurrentStillDuration(): number {
        if (!this.isCurrentlyStill || this.stillStartTime === null) return 0;
        return performance.now() - this.stillStartTime;
    }

    /**
     * Get recent still periods for analysis
     */
    public getStillPeriods(): { start: number; end: number; duration: number }[] {
        return [...this.stillPeriods];
    }

    /**
     * Check if we just exited a significant still period (good cue point indicator)
     * A significant still period is one that lasted at least the minimum duration
     */
    public hasRecentStillPeriod(withinMs: number = 500): boolean {
        if (this.stillPeriods.length === 0) return false;
        const lastStill = this.stillPeriods[this.stillPeriods.length - 1];
        return (performance.now() - lastStill.end) < withinMs;
    }
}
