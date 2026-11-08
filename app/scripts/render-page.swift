import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: render-page <page.html> <out.png> [width] [height|full]\n".data(using: .utf8)!)
    exit(2)
}
let page = URL(fileURLWithPath: args[1]).standardizedFileURL
let out = URL(fileURLWithPath: args[2])
let width = CGFloat(args.count > 3 ? Double(args[3]) ?? 1280 : 1280)
let full = args.count > 4 && args[4] == "full"
let height = CGFloat(args.count > 4 && !full ? Double(args[4]) ?? 800 : 800)

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

final class Nav: NSObject, WKNavigationDelegate {
    var done = false
    var error: String?
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { done = true }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { error = e.localizedDescription; done = true }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { error = e.localizedDescription; done = true }
}

func spin(_ timeout: Double, until: () -> Bool) {
    let end = Date().addingTimeInterval(timeout)
    while !until() && Date() < end {
        RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.01))
    }
}

func js(_ web: WKWebView, _ code: String) -> Any? {
    var result: Any?
    var finished = false
    web.evaluateJavaScript(code) { value, _ in result = value; finished = true }
    spin(5) { finished }
    return result
}

let window = NSWindow(contentRect: NSRect(x: -6000, y: -6000, width: width, height: height),
                      styleMask: [.borderless], backing: .buffered, defer: false)
window.orderBack(nil)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height))
let nav = Nav()
web.navigationDelegate = nav
window.contentView?.addSubview(web)
web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
spin(15) { nav.done }
if let error = nav.error {
    print("{\"error\": \"\(error)\"}")
    exit(1)
}
spin(8) { (js(web, "Array.from(document.images).every(i => i.complete) && document.fonts.status === 'loaded'") as? Bool) == true }

let report = js(web, """
JSON.stringify({
  missing: Array.from(document.images).filter(i => !i.naturalWidth).map(i => i.getAttribute('src')),
  overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  scrollWidth: document.documentElement.scrollWidth,
  height: document.documentElement.scrollHeight,
  title: document.title
})
""") as? String ?? "{}"

if full, let data = report.data(using: .utf8),
   let info = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
   let h = info["height"] as? Double {
    let tall = min(CGFloat(h), 6000)
    window.setContentSize(NSSize(width: width, height: tall))
    web.frame = NSRect(x: 0, y: 0, width: width, height: tall)
    spin(1) { false }
}
spin(0.4) { false }

var saved = false
var finished = false
web.takeSnapshot(with: nil) { image, _ in
    defer { finished = true }
    guard let image = image, let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { return }
    saved = (try? png.write(to: out)) != nil
}
spin(10) { finished }
print(report)
exit(saved ? 0 : 1)
