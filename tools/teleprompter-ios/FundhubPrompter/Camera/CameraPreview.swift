import AVFoundation
import SwiftUI

/// The small camera box, only to line up. AVCaptureVideoPreviewLayer mirrors the
/// front camera on its own, like a mirror. A RotationCoordinator keeps it level
/// when the phone turns.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        private var coordinator: AVCaptureDevice.RotationCoordinator?
        private var watch: NSKeyValueObservation?

        func level() {
            guard coordinator == nil,
                  let input = previewLayer.session?.inputs.compactMap({ $0 as? AVCaptureDeviceInput })
                    .first(where: { $0.device.hasMediaType(.video) }) else { return }
            let c = AVCaptureDevice.RotationCoordinator(device: input.device, previewLayer: previewLayer)
            coordinator = c
            previewLayer.connection?.videoRotationAngle = c.videoRotationAngleForHorizonLevelPreview
            watch = c.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.new]) { [weak self] c, _ in
                DispatchQueue.main.async {
                    self?.previewLayer.connection?.videoRotationAngle = c.videoRotationAngleForHorizonLevelPreview
                }
            }
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            level()
        }
    }

    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.previewLayer.session = session
        v.previewLayer.videoGravity = .resizeAspectFill
        v.backgroundColor = .black
        return v
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        uiView.level()
    }
}
