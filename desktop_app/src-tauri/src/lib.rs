use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{CustomMenuItem, Menu, MenuItem, Submenu, Manager};

struct BackendProcess(Arc<Mutex<Option<std::process::Child>>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let start_bot = CustomMenuItem::new("start_bot".to_string(), "Start Trading Bot");
  let stop_bot = CustomMenuItem::new("stop_bot".to_string(), "Stop Trading Bot");
  let trading_submenu = Submenu::new("Trading", Menu::new().add_item(start_bot).add_item(stop_bot));

  let docs = CustomMenuItem::new("docs".to_string(), "Documentation");
  let help_submenu = Submenu::new("Help", Menu::new().add_item(docs));

  let menu = Menu::new()
    .add_native_item(MenuItem::Copy)
    .add_submenu(trading_submenu)
    .add_submenu(help_submenu);

  tauri::Builder::default()
    .manage(BackendProcess(Arc::new(Mutex::new(None))))
    .menu(menu)
    .on_window_event(|event| {
      if let tauri::WindowEvent::CloseRequested { .. } = event.event() {
        let state = event.window().state::<BackendProcess>();
        let mut lock = state.0.lock().unwrap();
        if let Some(mut child) = lock.take() {
            println!("🛑 [RUST] Killing backend process...");
            let _ = child.kill();
        }
      }
    })
    .setup(|app| {
      let app_handle = app.handle();
      let backend_child = Arc::clone(&app.state::<BackendProcess>().0);

      // Start Backend (FastAPI)
      tauri::async_runtime::spawn(async move {
        let mut child = if cfg!(target_os = "windows") {
          Command::new("powershell")
            .args(["-Command", "cd ../backend_fastapi; .\\venv\\Scripts\\activate; python main.py"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to start backend")
        } else {
          Command::new("sh")
            .args(["-c", "cd ../backend_fastapi && . venv/bin/activate && python main.py"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to start backend")
        };

        let mut lock = backend_child.lock().unwrap();
        *lock = Some(child);
        println!("🚀 [RUST] FastAPI Backend started");
      });

      Ok(())
    })
    .on_menu_event(|event| {
      match event.menu_item_id() {
        "docs" => {
          let _ = tauri::async_runtime::spawn(async move {
            let _ = Command::new("powershell")
              .args(["-Command", "Start-Process 'https://github.com'"])
              .spawn();
          });
        }
        _ => {}
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
