import AVFoundation
import MediaPlayer
import UIKit

/// Maps a real output-volume change to a speed step.
/// 1 = louder = faster words. -1 = quieter = slower. 0 = no move.
enum VolumeWpm {
    static func direction(from old: Float, to new: Float) -> Int {
        if new > old + 0.001 { return 1 }
        if new < old - 0.001 { return -1 }
        return 0
    }

    /// At the ends the next press cannot move the level, so the words would stick.
    static func shouldRecenter(_ volume: Float) -> Bool {
        volume <= 0.12 || volume >= 0.88
    }
}

/// Watches AVAudioSession.outputVolume. Does not invent a step when the level stays put.
final class VolumeButtonWatch: NSObject {
    var onStep: ((Int) -> Void)?
    private var last: Float = -1
    private var writing = false
    private var started = false
    private let sliderHost = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 1, height: 1))

    func start(on host: UIView) {
        guard !started else { return }
        started = true
        sliderHost.alpha = 0.01
        sliderHost.isUserInteractionEnabled = false
        host.addSubview(sliderHost)
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(true)
        last = session.outputVolume
        session.addObserver(self, forKeyPath: "outputVolume", options: [.new], context: nil)
    }

    func stop() {
        guard started else { return }
        started = false
        AVAudioSession.sharedInstance().removeObserver(self, forKeyPath: "outputVolume")
        sliderHost.removeFromSuperview()
        last = -1
    }

    override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?, context: UnsafeMutableRawPointer?) {
        guard keyPath == "outputVolume", !writing else { return }
        let v = AVAudioSession.sharedInstance().outputVolume
        let prev = last
        last = v
        guard prev >= 0 else { return }
        let dir = VolumeWpm.direction(from: prev, to: v)
        if dir != 0 { onStep?(dir) }
        if VolumeWpm.shouldRecenter(v) { recenter() }
    }

    private func recenter() {
        guard let slider = sliderHost.subviews.compactMap({ $0 as? UISlider }).first else { return }
        writing = true
        slider.value = 0.5
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self else { return }
            self.last = AVAudioSession.sharedInstance().outputVolume
            self.writing = false
        }
    }
}
