//! Native file selection. Only fixed application prompts cross the OS dialog boundary.
use std::path::PathBuf;

use super::codec::PortableArtifactRejected;

#[cfg(target_os = "linux")]
pub(super) fn choose(
    title: &'static str,
    extension: &'static str,
    save_name: Option<&'static str>,
) -> Result<Option<PathBuf>, PortableArtifactRejected> {
    use std::{sync::mpsc, time::Duration};

    use gtk::{glib, prelude::*};

    if !gtk::is_initialized() || gtk::is_initialized_main_thread() {
        return Err(PortableArtifactRejected);
    }
    let (start, started) = mpsc::sync_channel(1);
    let (complete, completed) = mpsc::sync_channel(1);
    // Queue on the GTK thread even when there is no active workspace window or sign-in.
    glib::idle_add_once(move || {
        if !gtk::is_initialized_main_thread() || start.send(()).is_err() {
            return;
        }
        let action = if save_name.is_some() {
            gtk::FileChooserAction::Save
        } else {
            gtk::FileChooserAction::Open
        };
        let parent = gtk::Window::list_toplevels()
            .into_iter()
            .find_map(|widget| {
                widget
                    .downcast::<gtk::Window>()
                    .ok()
                    .filter(gtk::prelude::GtkWindowExt::is_active)
            });
        let dialog = gtk::FileChooserNative::new(Some(title), parent.as_ref(), action, None, None);
        dialog.set_modal(true);
        dialog.set_local_only(true);
        let filter = gtk::FileFilter::new();
        filter.add_pattern(&format!("*.{extension}"));
        dialog.add_filter(filter);
        if let Some(name) = save_name {
            dialog.set_current_name(name);
        }
        let selection = (dialog.run() == gtk::ResponseType::Accept)
            .then(|| dialog.filename())
            .flatten();
        let _ = complete.send(selection);
    });
    started
        .recv_timeout(Duration::from_secs(4))
        .map_err(|_| PortableArtifactRejected)?;
    completed.recv().map_err(|_| PortableArtifactRejected)
}

#[cfg(target_os = "macos")]
pub(super) fn choose(
    title: &'static str,
    _extension: &'static str,
    save_name: Option<&'static str>,
) -> Result<Option<PathBuf>, PortableArtifactRejected> {
    use std::{
        io::Read,
        process::{Command, Stdio},
    };
    // The dialog prints one POSIX path; anything longer is not a path it chose.
    const LIMIT: u64 = 16_384;
    let prompt = if let Some(name) = save_name {
        format!("POSIX path of (choose file name with prompt \"{title}\" default name \"{name}\")")
    } else {
        format!("POSIX path of (choose file with prompt \"{title}\")")
    };
    let mut child = Command::new("/usr/bin/osascript")
        .args(["-e", &prompt])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|_| PortableArtifactRejected)?;
    let mut bytes = Vec::new();
    let read = child
        .stdout
        .take()
        .ok_or(PortableArtifactRejected)?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes);
    if read.is_err() || bytes.len() as u64 > LIMIT {
        let _ = child.kill();
        let _ = child.wait();
        return Err(PortableArtifactRejected);
    }
    if !child
        .wait()
        .map_err(|_| PortableArtifactRejected)?
        .success()
    {
        return Ok(None);
    }
    let text = String::from_utf8(bytes).map_err(|_| PortableArtifactRejected)?;
    let path = text.strip_suffix('\n').ok_or(PortableArtifactRejected)?;
    Ok(Some(PathBuf::from(path)))
}

#[cfg(windows)]
pub(super) fn choose(
    title: &'static str,
    extension: &'static str,
    save_name: Option<&'static str>,
) -> Result<Option<PathBuf>, PortableArtifactRejected> {
    use winsafe::{self as w, co};
    let _apartment =
        w::CoInitializeEx(co::COINIT::APARTMENTTHREADED).map_err(|_| PortableArtifactRejected)?;
    if save_name.is_some() {
        let dialog = w::CoCreateInstance::<w::IFileSaveDialog>(
            &co::CLSID::FileSaveDialog,
            None::<&w::IUnknown>,
            co::CLSCTX::INPROC_SERVER,
        )
        .map_err(|_| PortableArtifactRejected)?;
        choose_windows_file(&dialog, title, extension, save_name)
    } else {
        let dialog = w::CoCreateInstance::<w::IFileOpenDialog>(
            &co::CLSID::FileOpenDialog,
            None::<&w::IUnknown>,
            co::CLSCTX::INPROC_SERVER,
        )
        .map_err(|_| PortableArtifactRejected)?;
        choose_windows_file(&dialog, title, extension, save_name)
    }
}

#[cfg(windows)]
fn choose_windows_file(
    dialog: &impl winsafe::prelude::shell_IFileDialog,
    title: &str,
    extension: &str,
    save_name: Option<&str>,
) -> Result<Option<PathBuf>, PortableArtifactRejected> {
    use winsafe::{self as w, co, prelude::*};
    let selected = (|| {
        dialog.SetTitle(title)?;
        dialog.SetFileTypes(&[(extension, &format!("*.{extension}"))])?;
        dialog.SetDefaultExtension(extension)?;
        let mut options = dialog.GetOptions()? | co::FOS::FORCEFILESYSTEM | co::FOS::PATHMUSTEXIST;
        if let Some(name) = save_name {
            dialog.SetFileName(name)?;
            options &= !co::FOS::OVERWRITEPROMPT;
        } else {
            options |= co::FOS::FILEMUSTEXIST;
        }
        dialog.SetOptions(options)?;
        if !dialog.Show(&w::HWND::NULL)? {
            return Ok(None);
        }
        dialog
            .GetResult()?
            .GetDisplayName(co::SIGDN::FILESYSPATH)
            .map(PathBuf::from)
            .map(Some)
    })();
    selected.map_err(|_: co::HRESULT| PortableArtifactRejected)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use gtk::{glib, prelude::*};
    use std::{cell::Cell, rc::Rc, sync::mpsc, time::Duration};

    #[test]
    #[ignore = "requires an isolated GTK display and no desktop portal"]
    fn native_chooser_accepts_a_file_then_cancels_without_a_result() {
        gtk::init().expect("GTK display");
        let dir = crate::test_tempdir::tempdir().unwrap();
        let fixture = dir.path().join("sample.gdbk");
        std::fs::write(&fixture, b"synthetic").unwrap();
        let run = |accept: bool| {
            let expected = fixture.clone();
            let seen = Rc::new(Cell::new(false));
            let observed = Rc::clone(&seen);
            let loop_ = glib::MainLoop::new(None, false);
            let finished = loop_.clone();
            let (send, recv) = mpsc::channel();
            let worker = std::thread::spawn(move || {
                let result = choose("Select synthetic backup", "gdbk", None);
                let _ = send.send(result);
            });
            let result = Rc::new(std::cell::RefCell::new(None));
            let response = Rc::clone(&result);
            glib::timeout_add_local(Duration::from_millis(60), move || {
                if let Ok(value) = recv.try_recv() {
                    *response.borrow_mut() = Some(value);
                    finished.quit();
                    return glib::ControlFlow::Break;
                }
                for chooser in gtk::Window::list_toplevels()
                    .into_iter()
                    .filter_map(|window| window.downcast::<gtk::FileChooserDialog>().ok())
                    .filter(gtk::prelude::WidgetExt::is_visible)
                {
                    if !observed.replace(true) {
                        if accept {
                            assert!(chooser.set_filename(&expected));
                        } else {
                            chooser.response(gtk::ResponseType::Cancel);
                        }
                    } else if accept && chooser.filename().as_ref() == Some(&expected) {
                        chooser.response(gtk::ResponseType::Accept);
                    }
                }
                glib::ControlFlow::Continue
            });
            loop_.run();
            worker.join().unwrap();
            assert!(seen.get(), "GTK displayed a real file chooser");
            result.borrow_mut().take().unwrap().unwrap()
        };
        assert_eq!(run(true), Some(fixture.clone()));
        assert_eq!(run(false), None);
    }
}
