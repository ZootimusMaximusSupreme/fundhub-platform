import SwiftUI
import UIKit

/// The bridge between the SwiftUI screen and the rolling words.
@MainActor
final class PrompterController: ObservableObject {
    @Published fileprivate(set) var mode: RollMode = .paused
    @Published fileprivate(set) var secondsLeft: Int = 0

    fileprivate weak var view: PrompterTextView?

    /// The last word rolled.
    var onEnd: (() -> Void)?
    /// Long press on a paragraph (or Edit): change its words.
    var onEditRequest: ((Int) -> Void)?
    /// Got it, Another take, Record from the remote.
    var onRemote: ((RemoteAction) -> Void)?
    /// The arrows changed the speed.
    var onSpeed: ((Int) -> Void)?
    /// Any touch or key, so the screen can show its buttons or keep them hidden.
    var onActivity: (() -> Void)?

    /// Settings › Learn remote: the next key press goes to this slot.
    @Published var learningSlot: RemoteAction?
    var onLearned: ((RemoteAction, String) -> Void)?

    var learnedKeys: [String: [String]] = [:]

    func togglePlay() { view?.togglePlay() }
    func pause() { view?.pause() }
    func restart() { view?.restart() }
    func releaseCue() { view?.releaseCue() }
    func currentParagraph() -> Int { view?.currentParagraph ?? 0 }
    func focusKeys() { view?.becomeFirstResponder() }
}

/// SwiftUI wrapper.
struct PrompterView: UIViewRepresentable {
    let paragraphs: [Paragraph]
    /// Changes when a different script opens (the words restart from the top).
    let scriptKey: String
    let settings: PrompterSettings
    let controller: PrompterController

    func makeUIView(context: Context) -> PrompterTextView {
        let v = PrompterTextView(controller: controller)
        controller.view = v
        v.update(paragraphs: paragraphs, scriptKey: scriptKey, settings: settings)
        return v
    }

    func updateUIView(_ v: PrompterTextView, context: Context) {
        controller.view = v
        v.update(paragraphs: paragraphs, scriptKey: scriptKey, settings: settings)
    }
}

/// The words on the dimmed camera: clear behind the type, white words, an amber reading line. Rolls on v1's
/// clock (PromptClock), flips for a beam-splitter rig, takes taps, drags,
/// a long press to edit, and Bluetooth remote / keyboard keys.
/// Thumb down moves the words up. Thumb up moves them down. A pause stops
/// the words only. This view never stops the camera.
final class PrompterTextView: UIView, UITextViewDelegate, UIGestureRecognizerDelegate {
    private let flipBox = UIView()
    private let textView = UITextView(usingTextLayoutManager: false)
    private let lineMarker = UIView()
    private let arrow = UILabel()
    private let countLabel = UILabel()
    private let progressTrack = UIView()
    private let progressFill = UIView()

    private unowned let controller: PrompterController

    private var paragraphs: [Paragraph] = []
    private var scriptKey = ""
    private var settings = PrompterSettings()
    private var clock = PromptClock(paragraphs: [], wpm: 150, pauseSeconds: 0.8)
    private var track = ScrollTrack(clock: PromptClock(paragraphs: [], wpm: 150, pauseSeconds: 0.8), wordY: [])
    private var paraRanges: [NSRange] = []
    private var wordRanges: [NSRange] = []
    private var mappedWidth: CGFloat = -1
    private var mappedHeight: CGFloat = -1

    private var t: Double = 0
    private var released = Set<Int>()
    private var tapRules = TapRules()
    private var link: CADisplayLink?
    private var lastStamp: CFTimeInterval = 0
    private var countdownLeft: Double = 0
    private var userScrolling = false
    private var settingOffset = false
    /// Reading-clock time where this thumb drag started, and how far the
    /// thumb had already moved when the drag was recognized.
    private var dragStartT: Double = 0
    private var dragStartY: CGFloat = 0

    private var mode: RollMode = .paused {
        didSet {
            guard mode != oldValue else { return }
            // Published on the next turn: this can run inside a SwiftUI view update.
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                if self.controller.mode != self.mode { self.controller.mode = self.mode }
            }
            // Stay awake after a pause too. A pause is only the words. If the
            // screen slept during an edit, the camera take would be cut.
            // Leaving the script turns the wake lock off.
            if mode == .rolling || mode == .countdown || mode == .holding || mode == .paused || mode == .scroll {
                UIApplication.shared.isIdleTimerDisabled = true
            }
            countLabel.isHidden = mode != .countdown
            if !isRollingMode, let w = pendingWords {
                pendingWords = nil
                applyWords(w)
            }
            if mode == .ended { controller.onEnd?() }
        }
    }

    /// New words from the server that came in while rolling: shown at the next pause.
    private var pendingWords: [Paragraph]?
    private var isRollingMode: Bool { mode == .rolling || mode == .countdown || mode == .holding }

    private var readingY: CGFloat { bounds.height * 0.3 }

    init(controller: PrompterController) {
        self.controller = controller
        super.init(frame: .zero)
        overrideUserInterfaceStyle = .dark
        backgroundColor = .clear
        isOpaque = false
        flipBox.backgroundColor = .clear
        flipBox.isOpaque = false
        addSubview(flipBox)

        textView.overrideUserInterfaceStyle = .dark
        textView.backgroundColor = .clear
        textView.isOpaque = false
        textView.textColor = .white
        textView.isEditable = false
        textView.isSelectable = false
        textView.isScrollEnabled = false
        textView.showsVerticalScrollIndicator = false
        textView.contentInsetAdjustmentBehavior = .never
        textView.textContainer.lineFragmentPadding = 0
        textView.delegate = self
        textView.accessibilityIdentifier = "prompter.words"
        flipBox.addSubview(textView)

        lineMarker.backgroundColor = UIColor(red: 1, green: 0.75, blue: 0.2, alpha: 0.35)
        lineMarker.isUserInteractionEnabled = false
        flipBox.addSubview(lineMarker)
        arrow.text = "▶"
        arrow.textColor = UIColor(red: 1, green: 0.75, blue: 0.2, alpha: 0.9)
        arrow.font = .systemFont(ofSize: 18)
        flipBox.addSubview(arrow)

        countLabel.textColor = .white
        countLabel.font = .systemFont(ofSize: 160, weight: .heavy)
        countLabel.textAlignment = .center
        countLabel.isHidden = true
        countLabel.isUserInteractionEnabled = false
        flipBox.addSubview(countLabel)

        progressTrack.backgroundColor = UIColor(white: 1, alpha: 0.12)
        progressFill.backgroundColor = UIColor(red: 1, green: 0.75, blue: 0.2, alpha: 0.8)
        progressTrack.addSubview(progressFill)
        progressTrack.isUserInteractionEnabled = false
        flipBox.addSubview(progressTrack)

        let single = UITapGestureRecognizer(target: self, action: #selector(singleTap(_:)))
        single.delegate = self
        let double = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
        double.numberOfTapsRequired = 2
        double.delegate = self
        let long = UILongPressGestureRecognizer(target: self, action: #selector(longPress(_:)))
        long.minimumPressDuration = 0.55
        long.delegate = self
        let pan = UIPanGestureRecognizer(target: self, action: #selector(panned(_:)))
        pan.delegate = self
        pan.maximumNumberOfTouches = 1
        textView.addGestureRecognizer(single)
        textView.addGestureRecognizer(double)
        textView.addGestureRecognizer(long)
        textView.addGestureRecognizer(pan)

        link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link?.add(to: .main, forMode: .common)

        NotificationCenter.default.addObserver(self, selector: #selector(becameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    deinit {
        link?.invalidate()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    // MARK: - Words in

    func update(paragraphs new: [Paragraph], scriptKey key: String, settings s: PrompterSettings) {
        let looksChanged = s.fontSize != settings.fontSize || s.lineWidth != settings.lineWidth
        let timingChanged = s.wpm != settings.wpm || s.pauseSeconds != settings.pauseSeconds
        let flipChanged = s.mirror != settings.mirror || s.flipVertical != settings.flipVertical
        let newScript = key != scriptKey
        let wordsChanged = new != paragraphs
        settings = s
        controller.learnedKeys = s.learnedKeys

        if flipChanged || flipBox.transform == .identity {
            flipBox.transform = CGAffineTransform(scaleX: s.mirror ? -1 : 1, y: s.flipVertical ? -1 : 1)
        }

        if newScript {
            scriptKey = key
            pendingWords = nil
            paragraphs = new
            t = 0
            released = []
            mode = .paused
            render(keepWord: nil)
        } else if wordsChanged {
            if isRollingMode {
                // Never swap the words under Chris mid-read; show them at the next pause.
                pendingWords = new
                if looksChanged || timingChanged { render(keepWord: clock.words.isEmpty ? nil : clock.wordIndex(at: t)) }
            } else {
                applyWords(new)
            }
        } else if looksChanged || timingChanged {
            render(keepWord: clock.words.isEmpty ? nil : clock.wordIndex(at: t))
        }
    }

    /// Edited on the fly: roll on from the start of the paragraph that was being read.
    private func applyWords(_ new: [Paragraph]) {
        let p = currentParagraph
        paragraphs = new
        render(keepWord: nil)
        let first = clock.words.firstIndex { $0.paragraph >= min(p, max(0, paragraphs.count - 1)) } ?? 0
        t = clock.startOf(word: first)
        applyOffset()
    }

    /// Build the words and the reading clock. keepWord: stay on this word.
    private func render(keepWord: Int?) {
        let size = CGFloat(settings.fontSize)
        let plain = UIFont.systemFont(ofSize: size, weight: .semibold)
        let bold = UIFont.systemFont(ofSize: size, weight: .black)
        let amber = UIColor(red: 1, green: 0.75, blue: 0.2, alpha: 1)
        let cueColor = UIColor(red: 0.6, green: 0.85, blue: 1, alpha: 1)
        let style = NSMutableParagraphStyle()
        style.lineHeightMultiple = 1.12
        style.paragraphSpacing = size * 0.9

        let out = NSMutableAttributedString()
        paraRanges = []
        wordRanges = []
        for (i, p) in paragraphs.enumerated() {
            let start = out.length
            let color: UIColor = p.cue ? cueColor : .white
            out.append(NSAttributedString(string: p.text, attributes: [.font: plain, .foregroundColor: color, .paragraphStyle: style]))
            let ns = p.text as NSString
            var k = 0
            while k < ns.length {
                while k < ns.length, Self.isGap(ns.character(at: k)) { k += 1 }
                let s = k
                while k < ns.length, !Self.isGap(ns.character(at: k)) { k += 1 }
                if k > s {
                    let r = NSRange(location: start + s, length: k - s)
                    wordRanges.append(r)
                    let tok = ns.substring(with: NSRange(location: s, length: k - s))
                    if tok.contains("↑") { out.addAttribute(.foregroundColor, value: amber, range: r) }
                    if ScriptText.isCaps(tok) { out.addAttribute(.font, value: bold, range: r) }
                }
            }
            paraRanges.append(NSRange(location: start, length: out.length - start))
            if i < paragraphs.count - 1 {
                out.append(NSAttributedString(string: "\n", attributes: [.font: plain, .paragraphStyle: style]))
            }
        }
        textView.attributedText = out
        clock = PromptClock(paragraphs: paragraphs, wpm: settings.wpm, pauseSeconds: settings.pauseSeconds)
        mappedWidth = -1
        setNeedsLayout()
        layoutIfNeeded()
        if let w = keepWord { t = clock.startOf(word: w) }
        applyOffset()
    }

    private static func isGap(_ c: unichar) -> Bool { c == 0x20 || c == 0x0A || c == 0x09 }

    override func layoutSubviews() {
        super.layoutSubviews()
        flipBox.bounds = CGRect(origin: .zero, size: bounds.size)
        flipBox.center = CGPoint(x: bounds.midX, y: bounds.midY)
        textView.frame = flipBox.bounds
        let side = max(16, (bounds.width - bounds.width * CGFloat(settings.lineWidth)) / 2)
        textView.textContainerInset = UIEdgeInsets(top: 0, left: side, bottom: 0, right: side)
        textView.contentInset = UIEdgeInsets(top: readingY, left: 0, bottom: max(0, bounds.height - readingY), right: 0)
        lineMarker.frame = CGRect(x: 0, y: readingY - 1, width: bounds.width, height: 2)
        arrow.frame = CGRect(x: 4, y: readingY - 12, width: 24, height: 24)
        countLabel.frame = flipBox.bounds
        progressTrack.frame = CGRect(x: 0, y: bounds.height - 4, width: bounds.width, height: 4)
        if bounds.width != mappedWidth || bounds.height != mappedHeight {
            mappedWidth = bounds.width
            mappedHeight = bounds.height
            mapWords()
            applyOffset()
        }
    }

    /// Where each word's line sits, so the reading line can follow the clock.
    private func mapWords() {
        let lm = textView.layoutManager
        lm.ensureLayout(for: textView.textContainer)
        var ys: [Double] = []
        for r in wordRanges {
            let g = lm.glyphRange(forCharacterRange: r, actualCharacterRange: nil)
            let rect = lm.boundingRect(forGlyphRange: g, in: textView.textContainer)
            ys.append(Double(rect.midY + textView.textContainerInset.top))
        }
        track = ScrollTrack(clock: clock, wordY: ys)
    }

    private func applyOffset() {
        guard bounds.height > 0 else { return }
        settingOffset = true
        textView.contentOffset = CGPoint(x: 0, y: CGFloat(track.y(at: t)) - readingY)
        settingOffset = false
        let f = clock.total > 0 ? min(1, t / clock.total) : 0
        progressFill.frame = CGRect(x: 0, y: 0, width: progressTrack.bounds.width * CGFloat(f), height: 4)
        let left = Int(track.wallRemaining(from: t).rounded(.up))
        if left != controller.secondsLeft {
            DispatchQueue.main.async { [weak self] in self?.controller.secondsLeft = max(0, left) }
        }
    }

    var currentParagraph: Int {
        guard !clock.words.isEmpty else { return 0 }
        return clock.words[clock.wordIndex(at: t)].paragraph
    }

    // MARK: - The clock

    @objc private func tick(_ l: CADisplayLink) {
        let dt = lastStamp == 0 ? 0 : min(0.1, l.timestamp - lastStamp)
        lastStamp = l.timestamp
        switch mode {
        case .countdown:
            countdownLeft -= dt
            let n = Int(ceil(countdownLeft))
            countLabel.text = n > 0 ? "\(n)" : ""
            if countdownLeft <= 0 { mode = .rolling }
        case .rolling:
            let before = t
            t += track.advance(from: before, wall: dt)
            if let hold = nextHold(after: before, upTo: t) {
                t = hold.end
                mode = .holding
            }
            if t >= clock.total {
                t = clock.total
                applyOffset()
                mode = .ended
                return
            }
            applyOffset()
        default:
            break
        }
    }

    /// Bullets mode: the first cue paragraph that ends between two moments and
    /// has not been let go yet.
    private func nextHold(after a: Double, upTo b: Double) -> (paragraph: Int, end: Double)? {
        for (i, p) in paragraphs.enumerated() where p.cue && !released.contains(i) {
            if let end = clock.endOf(paragraph: i), end > a - 0.0001, end <= b { return (i, end) }
        }
        return nil
    }

    // MARK: - Commands

    func togglePlay() {
        switch mode {
        case .rolling, .countdown: pause()
        case .holding: releaseCue()
        case .ended: break
        case .paused, .scroll: play()
        }
    }

    func play() {
        if t >= clock.total { t = 0; released = [] }
        if settings.countdown && t <= 0.001 {
            countdownLeft = 3
            mode = .countdown
        } else {
            mode = .rolling
        }
        applyOffset()
    }

    /// Stops the words. Does not stop the camera. The take keeps recording.
    func pause() {
        if mode == .rolling || mode == .countdown || mode == .holding { mode = .paused }
    }

    func restart() {
        t = 0
        released = []
        mode = .paused
        applyOffset()
        play()
    }

    func releaseCue() {
        guard mode == .holding else { return }
        released.insert(currentParagraphForHold())
        mode = .rolling
    }

    private func currentParagraphForHold() -> Int {
        for (i, p) in paragraphs.enumerated() where p.cue && !released.contains(i) {
            if let end = clock.endOf(paragraph: i), abs(end - t) < 0.01 { return i }
        }
        return currentParagraph
    }

    @objc private func becameActive() {
        if window != nil { becomeFirstResponder() }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { DispatchQueue.main.async { self.becomeFirstResponder() } }
    }

    // MARK: - Touch

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    @objc private func singleTap(_ g: UITapGestureRecognizer) {
        controller.onActivity?()
        switch tapRules.singleTap(at: CACurrentMediaTime(), mode: mode) {
        case .pause: pause()
        case .resume:
            if mode == .scroll { userScrolling = false }
            play()
        case .releaseCue: releaseCue()
        default: break
        }
    }

    @objc private func doubleTap(_ g: UITapGestureRecognizer) {
        controller.onActivity?()
        switch tapRules.doubleTap(at: CACurrentMediaTime()) {
        case .scrollOn: mode = .scroll
        case .scrollOff: mode = .paused
        default: break
        }
    }

    @objc private func longPress(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began else { return }
        pause()
        let p = g.location(in: textView)
        let inset = textView.textContainerInset
        let point = CGPoint(x: p.x - inset.left, y: p.y - inset.top)
        let lm = textView.layoutManager
        let idx = lm.characterIndex(for: point, in: textView.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
        let para = paraRanges.firstIndex { NSLocationInRange(idx, $0) || idx == $0.location + $0.length } ?? currentParagraph
        controller.onEditRequest?(para)
    }

    /// Thumb down: the words move up. Thumb up: the words move down.
    /// The words pause. The camera is not stopped.
    @objc private func panned(_ g: UIPanGestureRecognizer) {
        switch g.state {
        case .began:
            controller.onActivity?()
            userScrolling = true
            dragStartT = t
            dragStartY = g.translation(in: self).y
            if mode == .rolling || mode == .countdown || mode == .holding { mode = .paused }
        case .changed:
            let dy = g.translation(in: self).y - dragStartY
            let delta = PrompterDrag.offsetDelta(screenFingerDy: Double(dy), flippedVertically: settings.flipVertical)
            let y = track.y(at: dragStartT) + delta
            t = max(0, min(clock.total, track.t(at: y)))
            if mode == .ended { mode = .paused }
            applyOffset()
            released = released.filter { (clock.endOf(paragraph: $0) ?? 0) < t }
        case .ended, .cancelled, .failed:
            userScrolling = false
        default:
            break
        }
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        controller.onActivity?()
        userScrolling = true
        if mode == .rolling || mode == .countdown || mode == .holding { mode = .paused }
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard !settingOffset, userScrolling else { return }
        t = max(0, min(clock.total, track.t(at: Double(scrollView.contentOffset.y + readingY))))
        if mode == .ended { mode = .paused }
        let f = clock.total > 0 ? min(1, t / clock.total) : 0
        progressFill.frame = CGRect(x: 0, y: 0, width: progressTrack.bounds.width * CGFloat(f), height: 4)
        // Moving back over a cue lets it hold again.
        released = released.filter { (clock.endOf(paragraph: $0) ?? 0) < t }
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { userScrolling = false }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        userScrolling = false
    }

    // MARK: - Keys (Bluetooth remote, keyboard, foot pedal)

    override var canBecomeFirstResponder: Bool { true }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var handled = false
        for press in presses {
            guard let key = press.key else { continue }
            let id = RemoteKeys.id(hidUsage: key.keyCode.rawValue)
            controller.onActivity?()
            if let slot = controller.learningSlot {
                controller.learningSlot = nil
                controller.onLearned?(slot, id)
                handled = true
                continue
            }
            guard let action = RemoteKeys.action(for: id, learned: controller.learnedKeys, atEnd: mode == .ended) else { continue }
            handled = true
            switch action {
            case .play: togglePlay()
            case .restart: restart()
            case .faster: controller.onSpeed?(10)
            case .slower: controller.onSpeed?(-10)
            case .gotIt, .anotherTake, .record: controller.onRemote?(action)
            }
        }
        if !handled { super.pressesBegan(presses, with: event) }
    }
}
