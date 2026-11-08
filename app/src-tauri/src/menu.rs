use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, IsMenuItem, Menu, MenuItem, MenuItemBuilder,
    PredefinedMenuItem, Submenu, SubmenuBuilder, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Runtime};

const BROWSER_LABEL: &str = if cfg!(target_os = "macos") {
    "Open in Safari"
} else {
    "Open in Browser"
};

// Ctrl+Alt is AltGr on Windows and Linux, and AltGr+8 types `[` on a Finnish keyboard.
const FOLD_KEY: &str = if cfg!(target_os = "macos") {
    "Cmd+Alt+["
} else {
    "Ctrl+Shift+["
};
const UNFOLD_KEY: &str = if cfg!(target_os = "macos") {
    "Cmd+Alt+]"
} else {
    "Ctrl+Shift+]"
};

pub struct MenuHandles<R: Runtime> {
    pub items: Vec<(&'static str, MenuItem<R>)>,
    pub typing_helpers: CheckMenuItem<R>,
    pub autosave: CheckMenuItem<R>,
    pub boxes: CheckMenuItem<R>,
}

pub const FILE_ITEMS: &[(&str, &str, Option<&str>)] = &[
    ("new", "New...", Some("CmdOrCtrl+N")),
    ("open", "Open...", Some("CmdOrCtrl+O")),
    ("add-file", "Add a New File...", Some("CmdOrCtrl+Shift+N")),
    ("save", "Save", Some("CmdOrCtrl+S")),
    ("save-copy", "Save a Copy...", Some("CmdOrCtrl+Shift+S")),
];
pub const FILE_ITEMS_2: &[(&str, &str, Option<&str>)] = &[
    ("close-tab", "Close Tab", Some("CmdOrCtrl+W")),
    ("show-folder", "Show Project Folder", None),
];
pub const EDIT_UNDO: &[(&str, &str, Option<&str>)] = &[
    ("undo", "Undo", Some("CmdOrCtrl+Z")),
    ("redo", "Redo", Some("CmdOrCtrl+Shift+Z")),
];
pub const EDIT_ITEMS: &[(&str, &str, Option<&str>)] =
    &[("select-all", "Select All", Some("CmdOrCtrl+A"))];
pub const EDIT_FIND: &[(&str, &str, Option<&str>)] = &[
    ("find", "Find", Some("CmdOrCtrl+F")),
    ("find-next", "Find Next", Some("CmdOrCtrl+G")),
    ("find-prev", "Find Previous", Some("CmdOrCtrl+Shift+G")),
    ("replace", "Replace", Some("CmdOrCtrl+Alt+F")),
];
pub const EDIT_CODE: &[(&str, &str, Option<&str>)] = &[
    ("comment", "Comment Line", Some("CmdOrCtrl+/")),
    ("tidy", "Tidy Indents", Some("CmdOrCtrl+Shift+I")),
];
pub const EDIT_FOLD: &[(&str, &str, Option<&str>)] = &[
    ("fold", "Fold This Part", Some(FOLD_KEY)),
    ("unfold", "Unfold This Part", Some(UNFOLD_KEY)),
    ("unfold-all", "Unfold Everything", None),
];
pub const VIEW_SEE: &[(&str, &str, Option<&str>)] = &[("point", "Point at the Page", None)];
pub const VIEW_ITEMS: &[(&str, &str, Option<&str>)] = &[
    ("my-page", "My Page", Some("CmdOrCtrl+Shift+M")),
    ("help", "Help", Some("CmdOrCtrl+Shift+H")),
];
pub const VIEW_TEXT: &[(&str, &str, Option<&str>)] = &[
    ("bigger", "Bigger Text", Some("CmdOrCtrl+=")),
    ("smaller", "Smaller Text", Some("CmdOrCtrl+-")),
    ("normal-size", "Normal Text", Some("CmdOrCtrl+0")),
];
pub const VIEW_WIDTHS: &[(&str, &str, Option<&str>)] = &[
    ("width-phone", "Phone Size", None),
    ("width-tablet", "Tablet Size", None),
    ("width-full", "Full Size", None),
    ("safari", BROWSER_LABEL, None),
];
pub const WINDOW_TABS: &[(&str, &str, Option<&str>)] = &[
    ("next-tab", "Next Tab", Some("Ctrl+Tab")),
    ("prev-tab", "Previous Tab", Some("Ctrl+Shift+Tab")),
    ("tab-1", "Tab 1", Some("CmdOrCtrl+1")),
    ("tab-2", "Tab 2", Some("CmdOrCtrl+2")),
    ("tab-3", "Tab 3", Some("CmdOrCtrl+3")),
    ("tab-4", "Tab 4", Some("CmdOrCtrl+4")),
    ("tab-5", "Tab 5", Some("CmdOrCtrl+5")),
    ("tab-6", "Tab 6", Some("CmdOrCtrl+6")),
    ("tab-7", "Tab 7", Some("CmdOrCtrl+7")),
    ("tab-8", "Tab 8", Some("CmdOrCtrl+8")),
    ("tab-9", "Tab 9", Some("CmdOrCtrl+9")),
];
pub const HELP_ITEMS: &[(&str, &str, Option<&str>)] = &[
    ("help-home", "HTML Lab Help", None),
    ("help-word", "Help on This Word", Some("CmdOrCtrl+Shift+L")),
];
pub const HELP_GROUPS: &[(&str, &str, Option<&str>)] = &[
    ("help-start", "Start here", None),
    ("help-recipes", "I want to...", None),
    ("help-html", "HTML", None),
    ("help-ways", "Three ways to add CSS", None),
    ("help-css", "CSS", None),
    ("help-lookup", "Look-up lists", None),
];

const NEEDS_TAB: &[&str] = &[
    "add-file",
    "save",
    "save-copy",
    "close-tab",
    "show-folder",
    "tidy",
    "fold",
    "unfold",
    "unfold-all",
    "point",
    "safari",
    "help-word",
];
const APP_COMMANDS: &[&str] = &[
    "new",
    "open",
    "add-file",
    "save",
    "save-copy",
    "close-tab",
    "show-folder",
    "find",
    "find-next",
    "find-prev",
    "replace",
    "comment",
    "tidy",
    "fold",
    "unfold",
    "unfold-all",
    "point",
    "my-page",
    "help",
    "bigger",
    "smaller",
    "normal-size",
    "width-phone",
    "width-tablet",
    "width-full",
    "safari",
    "next-tab",
    "prev-tab",
    "tab-1",
    "tab-2",
    "tab-3",
    "tab-4",
    "tab-5",
    "tab-6",
    "tab-7",
    "tab-8",
    "tab-9",
    "help-home",
    "help-word",
    "help-start",
    "help-recipes",
    "help-html",
    "help-ways",
    "help-css",
    "help-lookup",
];

pub fn build<R: Runtime>(
    app: &AppHandle<R>,
    typing_helpers: bool,
    autosave: bool,
) -> tauri::Result<(Menu<R>, MenuHandles<R>)> {
    let mut items: Vec<(&'static str, MenuItem<R>)> = Vec::new();
    let mut make =
        |list: &[(&'static str, &str, Option<&str>)]| -> tauri::Result<Vec<MenuItem<R>>> {
            let mut out = Vec::new();
            for &(id, label, accel) in list {
                let mut b = MenuItemBuilder::with_id(id, label);
                if let Some(a) = accel {
                    b = b.accelerator(a);
                }
                let item = b.build(app)?;
                items.push((id, item.clone()));
                out.push(item);
            }
            Ok(out)
        };

    let file_a = make(FILE_ITEMS)?;
    let file_b = make(FILE_ITEMS_2)?;
    let undo = make(EDIT_UNDO)?;
    let select_all = make(EDIT_ITEMS)?;
    let find = make(EDIT_FIND)?;
    let code = make(EDIT_CODE)?;
    let fold = make(EDIT_FOLD)?;
    let see = make(VIEW_SEE)?;
    let view_a = make(VIEW_ITEMS)?;
    let view_b = make(VIEW_TEXT)?;
    let view_c = make(VIEW_WIDTHS)?;
    let win_tabs = make(WINDOW_TABS)?;
    let help_a = make(HELP_ITEMS)?;
    let help_b = make(HELP_GROUPS)?;

    let quit = MenuItemBuilder::with_id("quit", "Quit HTML Lab")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let about = PredefinedMenuItem::about(app, Some("About HTML Lab"), None)?;

    let is_mac = cfg!(target_os = "macos");

    let autosave_item = CheckMenuItemBuilder::with_id("autosave", "Save Automatically")
        .checked(autosave)
        .build(app)?;
    let typing_item = CheckMenuItemBuilder::with_id("typing-helpers", "Typing Helpers")
        .checked(typing_helpers)
        .build(app)?;
    let boxes_item = CheckMenuItemBuilder::with_id("boxes", "Show the Boxes")
        .checked(false)
        .enabled(false)
        .build(app)?;

    let file_menu = {
        let mut b = SubmenuBuilder::new(app, "File");
        for i in &file_a {
            b = b.item(i);
        }
        b = b.item(&autosave_item).separator();
        for i in &file_b {
            b = b.item(i);
        }
        if !is_mac {
            b = b.separator().item(&quit);
        }
        b.build()?
    };

    let edit_menu = {
        let mut b = SubmenuBuilder::new(app, "Edit");
        for i in &undo {
            b = b.item(i);
        }
        b = b
            .separator()
            .item(&PredefinedMenuItem::cut(app, None)?)
            .item(&PredefinedMenuItem::copy(app, None)?)
            .item(&PredefinedMenuItem::paste(app, None)?);
        for i in &select_all {
            b = b.item(i);
        }
        b = b.separator();
        for i in &find {
            b = b.item(i);
        }
        b = b.separator();
        for i in &code {
            b = b.item(i);
        }
        b = b.separator();
        for i in &fold {
            b = b.item(i);
        }
        b.build()?
    };

    let view_menu = {
        let mut b = SubmenuBuilder::new(app, "View");
        for i in &view_a {
            b = b.item(i);
        }
        b = b.separator();
        for i in &view_b {
            b = b.item(i);
        }
        b = b.separator().item(&typing_item).separator();
        for i in &see {
            b = b.item(i);
        }
        b = b.item(&boxes_item).separator();
        for i in &view_c {
            b = b.item(i);
        }
        if is_mac {
            b = b.separator().item(&PredefinedMenuItem::fullscreen(
                app,
                Some("Enter Full Screen"),
            )?);
        }
        b.build()?
    };

    let window_menu = {
        let mut children: Vec<Box<dyn IsMenuItem<R>>> = vec![
            Box::new(PredefinedMenuItem::minimize(app, None)?),
            Box::new(PredefinedMenuItem::maximize(app, Some("Zoom"))?),
            Box::new(PredefinedMenuItem::separator(app)?),
        ];
        for i in &win_tabs {
            children.push(Box::new(i.clone()));
        }
        let refs: Vec<&dyn IsMenuItem<R>> = children.iter().map(|b| b.as_ref()).collect();
        Submenu::with_id_and_items(app, WINDOW_SUBMENU_ID, "Window", true, &refs)?
    };

    let help_menu = {
        let mut children: Vec<Box<dyn IsMenuItem<R>>> = Vec::new();
        for i in &help_a {
            children.push(Box::new(i.clone()));
        }
        children.push(Box::new(PredefinedMenuItem::separator(app)?));
        for i in &help_b {
            children.push(Box::new(i.clone()));
        }
        if !is_mac {
            children.push(Box::new(PredefinedMenuItem::separator(app)?));
            children.push(Box::new(about.clone()));
        }
        let refs: Vec<&dyn IsMenuItem<R>> = children.iter().map(|b| b.as_ref()).collect();
        Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &refs)?
    };

    let menu = Menu::new(app)?;
    if is_mac {
        let app_menu = SubmenuBuilder::new(app, "HTML Lab")
            .item(&about)
            .separator()
            .item(&PredefinedMenuItem::hide(app, Some("Hide HTML Lab"))?)
            .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
            .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
            .separator()
            .item(&quit)
            .build()?;
        menu.append(&app_menu)?;
    }
    menu.append(&file_menu)?;
    menu.append(&edit_menu)?;
    menu.append(&view_menu)?;
    menu.append(&window_menu)?;
    menu.append(&help_menu)?;
    Ok((
        menu,
        MenuHandles {
            items,
            typing_helpers: typing_item,
            autosave: autosave_item,
            boxes: boxes_item,
        },
    ))
}

pub fn item_enabled(id: &str, has_tabs: bool, has_folder: bool, dialog_open: bool) -> bool {
    if dialog_open && APP_COMMANDS.contains(&id) {
        return false;
    }
    if !has_tabs && NEEDS_TAB.contains(&id) {
        return false;
    }
    if id == "show-folder" && !has_folder {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn all() -> Vec<&'static (&'static str, &'static str, Option<&'static str>)> {
        [
            FILE_ITEMS,
            FILE_ITEMS_2,
            EDIT_UNDO,
            EDIT_ITEMS,
            EDIT_FIND,
            EDIT_CODE,
            EDIT_FOLD,
            VIEW_SEE,
            VIEW_ITEMS,
            VIEW_TEXT,
            VIEW_WIDTHS,
            WINDOW_TABS,
            HELP_ITEMS,
            HELP_GROUPS,
        ]
        .iter()
        .flat_map(|l| l.iter())
        .collect()
    }

    #[test]
    fn every_accelerator_parses() {
        for (id, _, accel) in all() {
            if let Some(a) = accel {
                assert!(
                    muda::accelerator::Accelerator::from_str(a).is_ok(),
                    "{id}: {a} does not parse"
                );
            }
        }
        assert!(muda::accelerator::Accelerator::from_str("CmdOrCtrl+Q").is_ok());
    }

    #[test]
    fn no_accelerator_is_used_twice() {
        let mut seen = std::collections::HashSet::new();
        for (id, _, accel) in all() {
            if let Some(a) = accel {
                assert!(seen.insert(*a), "{id}: {a} is used twice");
            }
        }
    }

    #[test]
    fn ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for (id, _, _) in all() {
            assert!(seen.insert(*id), "{id} is used twice");
        }
    }

    #[test]
    fn enabled_rules() {
        assert!(!item_enabled("save", false, false, false));
        assert!(item_enabled("save", true, false, false));
        assert!(!item_enabled("show-folder", true, false, false));
        assert!(item_enabled("show-folder", true, true, false));
        assert!(!item_enabled("new", true, true, true));
        assert!(item_enabled("new", false, false, false));
        assert!(item_enabled("undo", true, true, true));
        assert!(item_enabled("select-all", false, false, true));
        for id in ["fold", "unfold", "unfold-all", "point"] {
            assert!(!item_enabled(id, false, false, false), "{id} without a tab");
            assert!(item_enabled(id, true, false, false), "{id} with a tab");
            assert!(!item_enabled(id, true, true, true), "{id} under a dialog");
        }
    }

    #[test]
    fn fold_keys_avoid_altgr_off_the_mac() {
        let keys: Vec<&str> = EDIT_FOLD.iter().filter_map(|(_, _, a)| *a).collect();
        assert_eq!(keys.len(), 2);
        for key in keys {
            if cfg!(target_os = "macos") {
                assert!(key.starts_with("Cmd+Alt+"), "{key}");
            } else {
                assert!(key.starts_with("Ctrl+Shift+"), "{key}");
            }
        }
    }
}
