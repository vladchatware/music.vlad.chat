/**
 * Simple BPM detector using beat tracking
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

    /**
     * Call this on every frame with the current bass energy
     * @param bassEnergy - Current bass energy (0-1)
     * @param threshold - Energy threshold to consider a beat (default 0.6)
     */
    public detectBeat(bassEnergy: number, threshold: number = 0.6): void {
        const now = performance.now();

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
    }

    /**
     * Check if we have a reliable BPM detection
     */
    public hasReliableBPM(): boolean {
        return this.detectedBPM !== null && this.getConfidence() > 0.5;
    }
}
