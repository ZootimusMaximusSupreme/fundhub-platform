import AVFoundation
import Photos

/// Saves a take to Photos under its take name (marketing/ads/NAMING.md):
/// `SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4`.
///
/// The camera writes a QuickTime .mov. The name ends in .mp4, so the take is
/// first copied into an MP4 box with no re-encode (AVAssetExportPresetPassthrough
/// — the picture is untouched). If that copy fails, the .mov is saved with the
/// same name and a .mov ending, so no take is ever lost.
enum PhotosSaver {
    struct SaveError: Error { var message: String }

    static func save(movie: URL, takeName: String) async -> Result<String, SaveError> {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            return .failure(SaveError(message: "Photos is off for Fundhub Prompter. Turn on Settings › Fundhub Prompter › Photos › Add Photos Only. The take is still on this phone until the app closes."))
        }
        var file = movie
        var name = takeName.hasSuffix(".mp4") ? takeName : takeName + ".mp4"
        if let mp4 = await remuxToMP4(movie) {
            file = mp4
            try? FileManager.default.removeItem(at: movie)
        } else {
            name = String(name.dropLast(4)) + ".mov"
        }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                let req = PHAssetCreationRequest.forAsset()
                let opts = PHAssetResourceCreationOptions()
                opts.originalFilename = name
                opts.shouldMoveFile = true
                req.addResource(with: .video, fileURL: file, options: opts)
            }
            return .success(name)
        } catch {
            return .failure(SaveError(message: "Photos did not take the video: \(error.localizedDescription)"))
        }
    }

    /// Same video and sound, MP4 box, no re-encode.
    static func remuxToMP4(_ url: URL) async -> URL? {
        let asset = AVURLAsset(url: url)
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else { return nil }
        let out = url.deletingPathExtension().appendingPathExtension("mp4")
        try? FileManager.default.removeItem(at: out)
        do {
            try await export.export(to: out, as: .mp4)
            return out
        } catch {
            return nil
        }
    }
}
