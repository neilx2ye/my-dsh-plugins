/**
 * Browser half of the Codex image gallery.
 *
 * Registers one control in the composer tool row. It opens a floating gallery
 * window (portaled to the document body, above the composer's clipped layer)
 * that lists the CURRENT PROJECT's images, previews one at full size, and
 * offers the actions that make an image usable: copy its project-relative path,
 * copy a Markdown embed, copy an absolute path, or download it. The same window
 * can ask the local Codex CLI, running inside the project, for a new image.
 */

window.__ModuleLoader__.load({
  id: '@local/codex-images',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'codexImages';
    /** Host routes backing the panel. App-owned browser routes are document-relative. */
    const LIST_URL = '/api/codex-images/list'.slice(1);
    const FILE_URL = '/api/codex-images/file'.slice(1);
    const GENERATE_URL = '/api/codex-images/generate'.slice(1);
    const RENAME_URL = '/api/codex-images/rename'.slice(1);
    const DELETE_URL = '/api/codex-images/delete'.slice(1);
    const ACCOUNT_URL = '/api/codex-images/account'.slice(1);
    const LOGIN_URL = '/api/codex-images/account/login'.slice(1);
    const LOGIN_CANCEL_URL = '/api/codex-images/account/cancel'.slice(1);
    const LOGOUT_URL = '/api/codex-images/account/logout'.slice(1);
    const LOGIN_CALLBACK_URL = '/api/codex-images/account/login/callback'.slice(1);
    const IMPORT_AUTH_URL = '/api/codex-images/account/import'.slice(1);
    const PROXY_URL = '/api/codex-images/account/proxy'.slice(1);
    const PROXY_TEST_URL = '/api/codex-images/account/proxy/test'.slice(1);
    const REFERENCE_URL = '/api/codex-images/reference'.slice(1);
    const REFERENCES_URL = '/api/codex-images/references'.slice(1);
    const REFERENCE_DELETE_URL = '/api/codex-images/references/delete'.slice(1);
    const REFERENCE_FROM_WORK_URL = '/api/codex-images/references/from-work'.slice(1);
    const CDN_URL = '/api/codex-images/cdn'.slice(1);

    /** Window geometry before viewport clamping. */
    const DEFAULT_WIDTH = 760;
    const DEFAULT_HEIGHT = 560;
    const VIEWPORT_MARGIN = 10;
    /** Room left below a newly opened window for the composer. */
    const COMPOSER_CLEARANCE = 190;
    /** Background refresh period while the window is open. */
    const REFRESH_MS = 12000;
    /** Sizes offered for a generated image. */
    const SIZES = ['1024x1024', '1536x1024', '1024x1536', 'auto'];

    const STYLE = `
.cxi-toggle{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;min-width:28px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.cxi-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cxi-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.cxi-toggle[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.cxi-window{position:fixed;z-index:70;box-sizing:border-box;display:flex;flex-direction:column;min-width:320px;min-height:260px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.45));overflow:hidden;font-size:13px}
.cxi-head{box-sizing:border-box;display:flex;flex:none;align-items:center;gap:8px;padding:8px 8px 8px 12px;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);min-width:0;cursor:grab;touch-action:none;user-select:none}
.cxi-head[data-dragging="true"]{cursor:grabbing}
.cxi-title{display:flex;align-items:center;gap:7px;min-width:0;font-weight:600;font-size:13px;white-space:nowrap}
.cxi-count{flex:none;min-width:18px;height:18px;padding:0 6px;border-radius:9px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;text-align:center}
.cxi-grow{flex:1;min-width:8px}
.cxi-ghost{appearance:none;flex:none;display:inline-flex;align-items:center;gap:5px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:4px 7px;font-size:12px;line-height:1.4;white-space:nowrap}
.cxi-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cxi-ghost:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.cxi-ghost:disabled{opacity:.45;cursor:default}
.cxi-ghost[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.cxi-gen{flex:none;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);padding:10px 12px 11px}
.cxi-gen-row{display:flex;align-items:flex-end;gap:8px}
.cxi-textarea{box-sizing:border-box;flex:1;min-width:0;min-height:58px;max-height:140px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:7px 9px;font:12px/1.55 inherit;outline:0}
.cxi-textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.cxi-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}
.cxi-side{display:flex;flex-direction:column;gap:6px;flex:none;align-items:stretch}
.cxi-select{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:4px 8px;font-size:12px;line-height:1.5}
.cxi-primary{appearance:none;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:8px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);cursor:pointer;padding:5px 12px;font-size:12px;font-weight:600;line-height:1.5;white-space:nowrap;text-decoration:none}
.cxi-primary:hover:not(:disabled){filter:brightness(1.08)}
.cxi-primary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.cxi-primary:disabled{opacity:.45;cursor:default}
.cxi-hint{margin-top:7px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.45}
.cxi-busy{display:flex;align-items:center;gap:8px;margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px}
.cxi-spinner{flex:none;width:13px;height:13px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:cxi-spin .8s linear infinite}
@keyframes cxi-spin{to{transform:rotate(360deg)}}
.cxi-body{flex:1;min-height:0;overflow:auto;padding:12px;scrollbar-width:thin;user-select:none}
.cxi-grid{columns:160px;column-gap:10px}
.cxi-card{appearance:none;display:block;position:relative;box-sizing:border-box;width:100%;margin:0 0 10px;padding:0;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;cursor:zoom-in;text-align:left;break-inside:avoid}
.cxi-card:hover{border-color:var(--dsw-alias-border-l2)}
.cxi-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.cxi-thumb{display:block;width:100%;height:auto;object-fit:contain;background:var(--dsw-alias-bg-layer-2)}
.cxi-card-label{display:block;padding:6px 8px 7px;min-width:0}
.cxi-card-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.4}
.cxi-card-meta{display:block;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cxi-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:220px;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary)}
.cxi-empty svg{width:34px;height:34px;opacity:.7}
.cxi-empty-title{font-weight:600;color:var(--dsw-alias-label-primary);font-size:13px}
.cxi-empty-body{max-width:460px;font-size:12px;line-height:1.65}
.cxi-sources{display:block;max-width:100%;box-sizing:border-box;margin-top:2px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;text-align:left}
.cxi-foot{flex:none;display:flex;align-items:center;gap:8px;min-height:28px;padding:5px 12px 6px;border-top:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4}
.cxi-foot-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cxi-error{flex:none;max-height:92px;overflow:auto;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.cxi-bad{color:var(--dsw-alias-state-error-primary)}
.cxi-good{color:var(--dsw-alias-state-success-primary)}
.cxi-detail{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1)}
.cxi-detail-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px 8px 12px;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2)}
.cxi-detail-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:12.5px}
.cxi-detail-body{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:12px;background:var(--dsw-alias-bg-base);overflow:hidden}
.cxi-detail-image{display:block;max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.cxi-detail-foot{flex:none;display:flex;flex-direction:column;gap:8px;padding:10px 12px 11px;border-top:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2)}
.cxi-detail-meta{display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;overflow-wrap:anywhere}
.cxi-detail-prompt{margin:0;max-height:44px;overflow:auto;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5}
.cxi-actions{display:flex;flex-wrap:wrap;gap:6px}
.cxi-btn{appearance:none;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;padding:4px 9px;font-size:11.5px;line-height:1.5;white-space:nowrap}
.cxi-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.cxi-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.cxi-btn:disabled{opacity:.45;cursor:default}
.cxi-btn.cxi-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2))}
.cxi-rename{display:flex;align-items:center;gap:6px}
.cxi-refs{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
.cxi-ref-chip{display:inline-flex;align-items:center;gap:5px;max-width:190px;padding:3px 4px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.cxi-ref-thumb{flex:none;width:24px;height:24px;border-radius:5px;object-fit:cover;background:var(--dsw-alias-bg-layer-2)}
.cxi-ref-name{min-width:0;max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.cxi-ref-remove{appearance:none;flex:none;width:18px;height:18px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:13px;line-height:1;padding:0}
.cxi-ref-remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cxi-tabs{display:flex;flex:none;gap:2px;padding:6px 10px 0;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2)}
.cxi-tab{appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:5px 10px 6px;font-size:12px;cursor:pointer;border-radius:6px 6px 0 0}
.cxi-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cxi-tab[data-active="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.cxi-refs-body{flex:1;min-height:0;overflow:auto;padding:12px;scrollbar-width:thin}
.cxi-refs-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.cxi-refs-info{min-width:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.cxi-ref-grid{columns:128px;column-gap:10px}
.cxi-ref-card{position:relative;display:block;width:100%;margin:0 0 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);break-inside:avoid}
.cxi-ref-card.is-selected{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.cxi-ref-pick{appearance:none;display:block;width:100%;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;text-align:left}
.cxi-ref-pick img{display:block;width:100%;height:auto;object-fit:contain}
.cxi-ref-card-name{display:block;padding:5px 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.cxi-ref-badge{position:absolute;top:6px;left:6px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-size:10px;line-height:1.5}
.cxi-ref-delete{appearance:none;position:absolute;top:6px;right:6px;width:20px;height:20px;border:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;font-size:13px;line-height:1;padding:0}
.cxi-ref-delete:hover{background:var(--dsw-alias-state-error-primary)}
.cxi-marquee{position:fixed;z-index:80;border:1px solid var(--dsw-alias-brand-primary);border-radius:4px;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);pointer-events:none}
.cxi-batch{position:sticky;top:0;z-index:3;display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:-12px -12px 10px;padding:8px 12px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l3)}
.cxi-batch-count{min-width:64px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.cxi-card[data-selected="true"]{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.cxi-card-check{position:absolute;top:6px;right:6px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-size:12px;font-weight:700}
.cxi-input{box-sizing:border-box;flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:3px 8px;font:12px/1.5 inherit;outline:0}
.cxi-input:focus{border-color:var(--dsw-alias-brand-primary)}
.cxi-account{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1)}
.cxi-account-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px 8px 12px;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2)}
.cxi-account-title{flex:1;min-width:0;font-weight:600;font-size:13px}
.cxi-account-body{flex:1;min-height:0;overflow:auto;padding:16px;scrollbar-width:thin}
.cxi-account-card{display:flex;flex-direction:column;gap:14px;max-width:560px;margin:0 auto}
.cxi-account-identity{display:flex;align-items:center;gap:12px;min-width:0}
.cxi-avatar{flex:none;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:600;font-size:17px;text-transform:uppercase}
.cxi-account-name{min-width:0}
.cxi-account-email{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:14px;color:var(--dsw-alias-label-primary)}
.cxi-account-sub{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.5}
.cxi-badge{display:inline-flex;align-items:center;align-self:flex-start;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);padding:1px 9px;font-size:11px;line-height:1.6;text-transform:capitalize}
.cxi-account-grid{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;align-items:start;font-size:12px;line-height:1.5}
.cxi-account-label{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.cxi-account-value{min-width:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.cxi-account-actions{display:flex;flex-wrap:wrap;gap:8px}
.cxi-quota-section{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.cxi-quota-title{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.cxi-quota{display:flex;flex-direction:column;gap:5px}
.cxi-quota-head{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.cxi-quota-bar{height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.cxi-quota-fill{height:100%;border-radius:3px;background:var(--dsw-alias-state-success-primary);transition:width .18s ease}
.cxi-quota-fill.is-warning{background:var(--dsw-alias-state-warn-primary)}
.cxi-quota-fill.is-danger{background:var(--dsw-alias-state-error-primary)}
.cxi-quota-state-danger{color:var(--dsw-alias-state-error-primary)}
.cxi-quota-meta{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.cxi-quota-note{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.cxi-callback{display:flex;flex-direction:column;gap:6px;margin-top:2px}
.cxi-import{display:flex;flex-direction:column;gap:6px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l3)}
.cxi-proxy{display:flex;flex-direction:column;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l3)}
.cxi-proxy-title{flex:none;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.cxi-proxy-toggle{appearance:none;display:flex;align-items:center;gap:8px;width:100%;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;text-align:left}
.cxi-proxy-toggle:hover .cxi-proxy-title{color:var(--dsw-alias-brand-primary)}
.cxi-proxy-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px;border-radius:4px}
.cxi-proxy-summary{min-width:0;margin-left:auto;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-tertiary)}
.cxi-proxy-chevron{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.cxi-proxy-body{display:flex;flex-direction:column;gap:6px}
.cxi-input-port{flex:none;width:86px}
.cxi-cdn-url{display:block;box-sizing:border-box;width:100%;max-height:64px;overflow:auto;margin:0;padding:7px 9px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;text-align:left}
.cxi-device{display:flex;flex-direction:column;gap:5px;padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.cxi-device-label{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.cxi-device-code{font:600 22px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.14em;color:var(--dsw-alias-label-primary);user-select:all}
.cxi-account-empty{display:flex;flex-direction:column;gap:12px;align-items:flex-start;padding:16px;border:1px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.cxi-account-empty svg{width:30px;height:30px;opacity:.75}
.cxi-account-hint{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.6;margin:0}
.cxi-auth-link{display:block;box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-brand-primary);font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;text-decoration:none}
.cxi-auth-link:hover{text-decoration:underline}
.cxi-account-error{border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;padding:10px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}
.cxi-account-output{margin:8px 0 0;max-height:130px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-secondary)}
.cxi-account-warn{border:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-border-l3));border-radius:10px;padding:9px 11px;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.6}
.cxi-account-foot{flex:none;padding:6px 12px 8px;border-top:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cxi-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`;

    const EN = {
      toggle: 'Codex images',
      title: 'Codex images',
      generate: 'Generate',
      generateTitle: 'Ask the local Codex CLI for an image',
      promptPlaceholder: 'Describe the image: subject, style, composition, and any text to render…',
      size: 'Size',
      generating: 'Codex CLI is generating — this can take a minute…',
      generated: 'Generated {count} image(s).',
      refresh: 'Refresh',
      close: 'Close',
      emptyTitle: 'No images in this project yet',
      emptyBody: 'Ask Codex CLI above, or put images in this project directory and refresh:',
      copyRelative: 'Copy relative path',
      rename: 'Rename',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      confirmDelete: 'Confirm delete',
      renamed: 'Renamed to {name}',
      deleted: 'Deleted {name}',
      renameNoSlash: 'The new name must not contain a path separator.',
      copyPath: 'Copy absolute path',
      copyMarkdown: 'Copy Markdown',
      download: 'Download',
      copied: 'Copied to clipboard.',
      created: 'Created',
      bytes: 'Bytes',
      openHint: 'Open preview',
      project: 'Project',
      directory: 'Image directory',
      back: 'Back to gallery',
      drag: 'Drag to move',
      loading: 'Loading images…',
      promptLabel: 'Prompt',
      notConfigured: 'Generation is disabled in this profile. Put images in this project directory and refresh.',
      generateHint: 'Runs the local Codex CLI inside this project and saves into {dir}. If Codex has no working image tool, its own error is shown here.',
      addReference: 'Reference',
      referenceHint: 'Up to 4 images, passed to Codex as Image 1…N in selection order.',
      removeReference: 'Remove reference',
      referenceTooLarge: 'A reference image must be at most 8 MiB.',
      galleryTab: 'Images',
      referencesTab: 'References',
      uploadReference: 'Upload reference',
      referenceLibraryHint: '{count} reference image(s); up to 4 can be used per generation.',
      selected: 'Selected',
      selectedCount: '{count} selected',
      deleteReference: 'Delete reference',
      referenceLimit: 'At most 4 reference images can be selected.',
      referenceLibraryEmpty: 'No reference images yet. Upload one above and select it here.',
      toReference: 'Use as reference',
      toReferenceDone: 'Added to references.',
      batchSelected: '{count} selected',
      batchReference: 'To references',
      batchDelete: 'Delete',
      batchReferenceDone: 'Converted {count} work(s) to references.',
      batchDeleted: 'Deleted {count} work(s).',
      dragSelectHint: 'Drag to select · Ctrl/Cmd+click to toggle',
      cdnTitle: 'Public access (CDN)',
      cdnOff: 'Off',
      cdnHint: 'Read-only image URLs with a random token. Open the port in your firewall; a public IP or port mapping/reverse proxy is required.',
      cdnPort: 'Port',
      cdnBase: 'Public base URL',
      cdnStart: 'Save & start',
      cdnStop: 'Stop',
      cdnCopy: 'Copy address',
      cdnRunning: 'Running on port {port}.',
      cdnStopped: 'Public access stopped.',
      cdnPublicIp: 'Public IP: {ip}',
      cdnNoPublicIp: 'No public IPv4 detected; port mapping or a reverse proxy may be required.',
      cdnTokenHint: 'Anyone with the link can read these images.',
      cdnDisabledNotice: 'Public access is off.',
      copyPublicLink: 'Copy public link',
      account: 'Codex account',
      accountTitle: 'Codex account',
      signedOut: 'Not signed in to Codex',
      signedOutBody: 'Sign-in happens in an isolated Codex home. Your terminal ~/.codex configuration and login are not changed.',
      deviceLogin: 'Sign in with a device code',
      browserLogin: 'Sign in in a browser',
      deviceCode: 'Device code',
      deviceHint: 'Open the verification page on any device that can reach OpenAI, enter this code, and this panel updates when it completes.',
      copyCode: 'Copy code',
      importAuth: 'Import auth.json',
      importHint: 'Signed in on another device? Upload that device\'s ~/.codex/auth.json; it is written only to this isolated Codex home.',
      authImported: 'auth.json imported.',
      importTooLarge: 'That file is too large to be an auth.json.',
      proxyTitle: 'Network proxy',
      proxyHint: 'Codex uses this proxy for ChatGPT. SOCKS is bridged to a local HTTP proxy automatically. Leave it empty for a direct connection.',
      proxySave: 'Save & test',
      proxyTest: 'Test',
      proxyClear: 'Clear',
      proxySaved: 'Proxy saved.',
      proxyReachable: 'Reachable (HTTP {code}).',
      proxyBlocked: 'The proxy exit is still blocked (HTTP {code}).',
      proxyFailed: 'Proxy test failed',
      proxyDirect: 'Direct connection.',
      proxySshHint: 'SSH reverse forward: reconnect with ssh -R 1080, then enter socks5h://127.0.0.1:1080.',
      signingIn: 'Starting the login…',
      waitingAuth: 'Waiting for browser authorization…',
      openAuth: 'Open authorization page',
      copyAuth: 'Copy link',
      signOut: 'Sign out',
      signedIn: 'Signed in',
      plan: 'Plan',
      planExpires: 'Plan expires',
      quotaTitle: 'Usage',
      quotaWeekly: 'Weekly quota',
      quotaFiveHour: '5-hour quota',
      quotaMinutes: '{mins}-minute quota',
      quotaRemaining: '{percent}% left',
      quotaUsed: 'used {percent}%',
      quotaResets: 'resets {time}',
      quotaExhausted: 'Limit reached',
      quotaUnavailable: 'Usage data is unavailable right now.',
      quotaExtra: 'Extra credits: {balance}',
      quotaUnlimited: 'Unlimited usage',
      quotaResetCredits: 'Full resets available: {count}',
      workspace: 'Workspace',
      providerWarning: 'OAuth signs you in, but generation still uses provider "{provider}".',
      codexHome: 'Isolated Codex home',
      loginFailed: 'Login failed',
      logoutDone: 'Signed out.',
      apiKeyMode: 'API key',
      chatgptMode: 'ChatGPT OAuth',
      loginHint: 'A browser page opens for authorization; this panel updates when it completes.',
      callbackHint: 'Authorized on another device? If the browser could not reach 127.0.0.1, paste the address it landed on.',
      callbackPlaceholder: 'http://127.0.0.1:1455/auth/callback?code=…&state=…',
      finishLogin: 'Complete sign-in',
    };

    const ZH = {
      toggle: 'Codex 图片',
      title: 'Codex 图片',
      generate: '生成',
      generateTitle: '让本机 Codex CLI 生成图片',
      promptPlaceholder: '描述画面：主体、风格、构图，以及需要出现的文字…',
      size: '尺寸',
      generating: 'Codex CLI 正在生成，可能需要一两分钟…',
      generated: '已生成 {count} 张图片。',
      refresh: '刷新',
      close: '关闭',
      emptyTitle: '当前项目还没有图片',
      emptyBody: '在上方让 Codex CLI 生成，或把图片放进当前项目的目录后刷新：',
      copyRelative: '复制相对路径',
      rename: '重命名',
      save: '保存',
      cancel: '取消',
      delete: '删除',
      confirmDelete: '确认删除',
      renamed: '已重命名为 {name}',
      deleted: '已删除 {name}',
      renameNoSlash: '新文件名不能包含路径分隔符。',
      copyPath: '复制绝对路径',
      copyMarkdown: '复制 Markdown',
      download: '下载',
      copied: '已复制到剪贴板。',
      created: '创建时间',
      bytes: '字节',
      openHint: '打开预览',
      project: '项目',
      directory: '图片目录',
      back: '返回画廊',
      drag: '拖动窗口',
      loading: '正在读取图片…',
      promptLabel: '提示词',
      notConfigured: '当前配置关闭了生成。把图片放进当前项目的目录后刷新即可。',
      generateHint: '在本项目内运行 Codex CLI，图片保存到 {dir}；如果 Codex 没有可用的生图能力，这里会显示它的原始报错。',
      addReference: '参考图',
      referenceHint: '最多 4 张，按选择顺序作为 Image 1…N 传给 Codex。',
      removeReference: '移除参考图',
      referenceTooLarge: '参考图不能超过 8 MiB。',
      galleryTab: '作品',
      referencesTab: '参考图',
      uploadReference: '上传参考图',
      referenceLibraryHint: '{count} 张参考图；每次生成最多选 4 张。',
      selected: '已选',
      selectedCount: '已选 {count} 张',
      deleteReference: '删除参考图',
      referenceLimit: '最多只能选 4 张参考图。',
      referenceLibraryEmpty: '还没有参考图。先在上方上传，再在这里选中。',
      toReference: '转为参考图',
      toReferenceDone: '已加入参考图。',
      batchSelected: '已选 {count} 张',
      batchReference: '转为参考图',
      batchDelete: '批量删除',
      batchReferenceDone: '已把 {count} 个作品转为参考图。',
      batchDeleted: '已删除 {count} 个作品。',
      dragSelectHint: '拖拽框选 · Ctrl/Cmd+点击切换选择',
      cdnTitle: '公网访问（CDN）',
      cdnOff: '未开启',
      cdnHint: '只读图片 URL，带随机 token。需要在防火墙放行端口，并且有公网 IP 或端口映射/反向代理。',
      cdnPort: '端口',
      cdnBase: '公网地址',
      cdnStart: '保存并启动',
      cdnStop: '停止',
      cdnCopy: '复制地址',
      cdnRunning: '已在端口 {port} 运行。',
      cdnStopped: '公网访问已停止。',
      cdnPublicIp: '公网 IP：{ip}',
      cdnNoPublicIp: '未检测到公网 IPv4，可能需要端口映射或反向代理。',
      cdnTokenHint: '拿到链接的人都能读取这些图片。',
      cdnDisabledNotice: '公网访问未开启。',
      copyPublicLink: '复制公网链接',
      account: 'Codex 账户',
      accountTitle: 'Codex 账户',
      signedOut: '尚未登录 Codex',
      signedOutBody: '登录会在独立的 Codex 环境中进行，不会改动你终端里的 ~/.codex 配置和登录状态。',
      deviceLogin: '使用设备码登录',
      browserLogin: '在浏览器中登录',
      deviceCode: '设备码',
      deviceHint: '在任何能访问 OpenAI 的设备打开验证页并输入此设备码；完成后这里会自动更新。',
      copyCode: '复制设备码',
      importAuth: '导入 auth.json',
      importHint: '在别的设备已登录 Codex？上传该设备的 ~/.codex/auth.json，只会写入这个独立 Codex 环境。',
      authImported: 'auth.json 已导入。',
      importTooLarge: '文件过大，不是正常的 auth.json。',
      proxyTitle: '网络代理',
      proxyHint: 'Codex 通过这个代理访问 ChatGPT；SOCKS 会自动经本地 HTTP 桥接。留空表示直连。',
      proxySave: '保存并测试',
      proxyTest: '测试',
      proxyClear: '清除',
      proxySaved: '代理已保存。',
      proxyReachable: '可连通（HTTP {code}）。',
      proxyBlocked: '该出口仍被拦截（HTTP {code}）。',
      proxyFailed: '代理测试失败',
      proxyDirect: '直连。',
      proxySshHint: 'SSH 反向转发：用 ssh -R 1080 重新连接，然后填 socks5h://127.0.0.1:1080。',
      signingIn: '正在启动登录…',
      waitingAuth: '等待浏览器授权…',
      openAuth: '打开授权页',
      copyAuth: '复制链接',
      signOut: '退出登录',
      signedIn: '已登录',
      plan: '套餐',
      planExpires: '套餐到期',
      quotaTitle: '额度',
      quotaWeekly: '每周额度',
      quotaFiveHour: '5 小时额度',
      quotaMinutes: '{mins} 分钟额度',
      quotaRemaining: '剩余 {percent}%',
      quotaUsed: '已用 {percent}%',
      quotaResets: '{time} 重置',
      quotaExhausted: '已用尽',
      quotaUnavailable: '暂时拿不到额度信息。',
      quotaExtra: '额外额度：{balance}',
      quotaUnlimited: '无限额度',
      quotaResetCredits: '可全额重置次数：{count}',
      workspace: '工作区',
      providerWarning: 'OAuth 只负责登录，生图仍使用供应商 “{provider}”。',
      codexHome: '独立 Codex 环境',
      loginFailed: '登录失败',
      logoutDone: '已退出登录。',
      apiKeyMode: 'API Key',
      chatgptMode: 'ChatGPT OAuth',
      loginHint: '会自动打开浏览器授权页；完成后这里会自动更新。',
      callbackHint: '在别的设备授权？如果浏览器打不开 127.0.0.1，把最终跳转到的地址复制回来。',
      callbackPlaceholder: 'http://127.0.0.1:1455/auth/callback?code=…&state=…',
      finishLogin: '完成登录',
    };

    /** One remembered window geometry across open/close within the page. */
    let savedGeometry = null;

    /**
     * Read a finite number with a fallback.
     * @param value - candidate.
     * @param fallback - value used when the candidate is not finite.
     * @returns a finite number.
     */
    function finite(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    }

    /**
     * Compute a centered window geometry above the composer.
     * @returns clamped geometry in viewport coordinates.
     */
    function defaultGeometry() {
      const viewportWidth = Math.max(360, window.innerWidth || 1024);
      const viewportHeight = Math.max(300, window.innerHeight || 768);
      const width = Math.min(DEFAULT_WIDTH, viewportWidth - 2 * VIEWPORT_MARGIN);
      const height = Math.min(DEFAULT_HEIGHT, Math.max(300, Math.round(viewportHeight * 0.62)));
      return {
        width,
        height,
        left: Math.round((viewportWidth - width) / 2),
        top: Math.max(VIEWPORT_MARGIN, Math.round(viewportHeight - height - COMPOSER_CLEARANCE)),
      };
    }

    /**
     * Keep a window geometry fully inside the viewport.
     * @param value - candidate geometry.
     * @returns clamped integer geometry.
     */
    function clampGeometry(value) {
      const fallback = defaultGeometry();
      const source = value !== null && typeof value === 'object' ? value : {};
      const viewportWidth = Math.max(360, window.innerWidth || 1024);
      const viewportHeight = Math.max(300, window.innerHeight || 768);
      const maxWidth = Math.max(300, viewportWidth - 2 * VIEWPORT_MARGIN);
      const maxHeight = Math.max(260, viewportHeight - 2 * VIEWPORT_MARGIN);
      const width = Math.min(maxWidth, Math.max(Math.min(320, maxWidth), finite(source.width, fallback.width)));
      const height = Math.min(maxHeight, Math.max(Math.min(260, maxHeight), finite(source.height, fallback.height)));
      const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
      const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN);
      const left = Math.min(maxLeft, Math.max(VIEWPORT_MARGIN, finite(source.left, fallback.left)));
      const top = Math.min(maxTop, Math.max(VIEWPORT_MARGIN, finite(source.top, fallback.top)));
      return {
        width: Math.round(width),
        height: Math.round(height),
        left: Math.round(left),
        top: Math.round(top),
      };
    }

    /**
     * Read a response body as JSON without throwing on a non-JSON error page.
     * @param response - fetch response.
     * @returns parsed JSON or an empty object.
     */
    async function readJson(response) {
      try {
        const value = await response.json();
        return value !== null && typeof value === 'object' ? value : {};
      } catch {
        return {};
      }
    }

    /**
     * Format one ISO timestamp for display.
     * @param value - ISO string.
     * @returns a short local date-time, or the input when unparsable.
     */
    function formatTime(value) {
      if (typeof value !== 'string' || value === '') return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      const pad = (part) => String(part).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /**
     * Format a byte count.
     * @param value - byte count.
     * @returns a compact size label.
     */
    function formatBytes(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
      return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * Copy text through the async clipboard, falling back to a hidden textarea.
     * @param text - text to copy.
     * @returns whether the copy succeeded.
     */
    async function copyText(text) {
      try {
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {}
      try {
        const node = document.createElement('textarea');
        node.value = text;
        node.setAttribute('readonly', '');
        node.style.position = 'fixed';
        node.style.opacity = '0';
        document.body.appendChild(node);
        node.select();
        const ok = document.execCommand('copy');
        node.remove();
        return ok;
      } catch {
        return false;
      }
    }

    /**
     * Build one browser image URL.
     * @param id - project-relative image id.
     * @param sessionId - owning Session.
     * @param download - whether the response should download.
     * @returns a document-relative URL.
     */
    function fileUrl(id, sessionId, download = false) {
      const query = new URLSearchParams({ id, sessionId });
      if (download) query.set('download', '1');
      return `${FILE_URL}?${query.toString()}`;
    }

    /**
     * Small picture glyph used by the composer toggle and headers.
     * @returns an inline SVG element.
     */
    function PictureIcon() {
      return h(
        'svg',
        { viewBox: '0 0 20 20', width: 15, height: 15, 'aria-hidden': 'true', focusable: 'false' },
        h('rect', { x: 2.5, y: 3.5, width: 15, height: 13, rx: 2.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
        h('circle', { cx: 7.4, cy: 8, r: 1.35, fill: 'currentColor' }),
        h('path', { d: 'M4.2 14.2l3.6-3.7 2.4 2.4 2.2-2.3 3.4 3.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round', strokeLinecap: 'round' }),
        h('path', { d: 'M15.2 2.1l.45 1.2 1.2.45-1.2.45-.45 1.2-.45-1.2-1.2-.45 1.2-.45z', fill: 'currentColor' }),
      );
    }

    /**
     * Account glyph used by the header button and the signed-out card.
     * @returns an inline SVG element.
     */
    function AccountIcon() {
      return h(
        'svg',
        { viewBox: '0 0 20 20', width: 15, height: 15, 'aria-hidden': 'true', focusable: 'false' },
        h('circle', { cx: 10, cy: 6.6, r: 3.1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M3.8 16.6c1.1-3.1 3.4-4.8 6.2-4.8s5.1 1.7 6.2 4.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      );
    }

    /**
     * The composer control plus the floating gallery it owns.
     * @param props.sessionId - owning Session.
     * @param props.t - namespace translator.
     * @returns the toggle and, while open, the gallery portal.
     */
    function CodexImages(props) {
      const { sessionId, t } = props;
      const [open, setOpen] = React.useState(false);
      const [images, setImages] = React.useState([]);
      const [project, setProject] = React.useState('');
      const [relative, setRelative] = React.useState('');
      const [canGenerate, setCanGenerate] = React.useState(true);
      const [loading, setLoading] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [generateOpen, setGenerateOpen] = React.useState(false);
      const [draft, setDraft] = React.useState('');
      const [size, setSize] = React.useState(SIZES[0]);
      const [selectedId, setSelectedId] = React.useState('');
      const [renaming, setRenaming] = React.useState(false);
      const [renameDraft, setRenameDraft] = React.useState('');
      const [confirmDelete, setConfirmDelete] = React.useState(false);
      const [accountOpen, setAccountOpen] = React.useState(false);
      const [account, setAccount] = React.useState(null);
      const [provider, setProvider] = React.useState(null);
      const [codexHome, setCodexHome] = React.useState('');
      const [login, setLogin] = React.useState({ phase: 'idle', url: '', error: '', output: '' });
      const [accountBusy, setAccountBusy] = React.useState(false);
      const [accountError, setAccountError] = React.useState('');
      const [callbackDraft, setCallbackDraft] = React.useState('');
      const [rateLimits, setRateLimits] = React.useState(null);
      const [proxyDraft, setProxyDraft] = React.useState('');
      const [proxyOpen, setProxyOpen] = React.useState(false);
      const [cdn, setCdn] = React.useState(null);
      const [cdnOpen, setCdnOpen] = React.useState(false);
      const [cdnPort, setCdnPort] = React.useState('8787');
      const [cdnBase, setCdnBase] = React.useState('');
      const [cdnBusy, setCdnBusy] = React.useState(false);
      const [cdnStatus, setCdnStatus] = React.useState('');
      const [references, setReferences] = React.useState([]);
      const [referenceBusy, setReferenceBusy] = React.useState(false);
      const [referenceLibrary, setReferenceLibrary] = React.useState([]);
      const [referenceLoading, setReferenceLoading] = React.useState(false);
      const [tab, setTab] = React.useState('gallery');
      const [selectedIds, setSelectedIds] = React.useState([]);
      const [dragRect, setDragRect] = React.useState(null);
      const [batchBusy, setBatchBusy] = React.useState(false);
      const [confirmBatchDelete, setConfirmBatchDelete] = React.useState(false);
      const [proxyStatus, setProxyStatus] = React.useState('');
      const [geometry, setGeometry] = React.useState(() => clampGeometry(savedGeometry));
      const geometryRef = React.useRef(geometry);
      const toggleRef = React.useRef(null);
      const promptRef = React.useRef(null);
      const authFileRef = React.useRef(null);
      const referenceInputRef = React.useRef(null);
      const bodyRef = React.useRef(null);
      const dragRef = React.useRef(null);
      const suppressClickRef = React.useRef(false);
      const cdnLoaded = React.useRef(false);
      const proxyLoaded = React.useRef(false);
      const noticeTimer = React.useRef(0);
      const [dragging, setDragging] = React.useState(false);

      const selected = images.find((image) => image.id === selectedId) ?? null;

      const showNotice = React.useCallback((message) => {
        setNotice(message);
        if (noticeTimer.current !== 0) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(''), 4200);
      }, []);

      const applyAccount = React.useCallback((data) => {
        setAccount(data !== null && typeof data.account === 'object' ? data.account : null);
        setProvider(data !== null && typeof data.provider === 'object' ? data.provider : null);
        setCodexHome(data !== null && typeof data.codexHome === 'string' ? data.codexHome : '');
        setLogin(data !== null && typeof data.login === 'object' ? data.login : { phase: 'idle', url: '', error: '', output: '' });
        setRateLimits(data !== null && typeof data.rateLimits === 'object' ? data.rateLimits : null);
        if (!proxyLoaded.current && data !== null && typeof data.proxy === 'string') {
          setProxyDraft(data.proxy);
          proxyLoaded.current = true;
        }
      }, []);

      const loadAccount = React.useCallback(async (options = {}) => {
        if (options.silent !== true) setAccountBusy(true);
        try {
          const response = await fetch(ACCOUNT_URL, { headers: { accept: 'application/json' } });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          applyAccount(data);
          if (options.silent !== true) setAccountError('');
        } catch (failure) {
          setAccountError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          if (options.silent !== true) setAccountBusy(false);
        }
      }, [applyAccount]);

      const load = React.useCallback(
        async (options = {}) => {
          if (options.silent !== true) setLoading(true);
          setError('');
          try {
            const response = await fetch(`${LIST_URL}?sessionId=${encodeURIComponent(sessionId)}`, {
              headers: { accept: 'application/json' },
            });
            const data = await readJson(response);
            if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
            const next = Array.isArray(data.images) ? data.images : [];
            setImages(next);
            setProject(typeof data.project === 'string' ? data.project : '');
            setRelative(typeof data.relative === 'string' ? data.relative : '');
            setCanGenerate(data.generate !== false);
            setSelectedId((current) => (next.some((image) => image.id === current) ? current : ''));
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
          } finally {
            if (options.silent !== true) setLoading(false);
          }
        },
        [sessionId, showNotice, t],
      );

      const loadReferences = React.useCallback(async () => {
        setReferenceLoading(true);
        try {
          const response = await fetch(`${REFERENCES_URL}?sessionId=${encodeURIComponent(sessionId)}`, {
            headers: { accept: 'application/json' },
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          setReferenceLibrary(Array.isArray(data.references) ? data.references : []);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setReferenceLoading(false);
        }
      }, [sessionId]);

      const applyCdn = React.useCallback((data) => {
        setCdn(data);
        if (!cdnLoaded.current) {
          setCdnPort(String(data !== null && typeof data.port === 'number' ? data.port : 8787));
          setCdnBase(data !== null && typeof data.publicBaseUrl === 'string' ? data.publicBaseUrl : '');
          cdnLoaded.current = true;
        }
      }, []);

      const loadCdn = React.useCallback(async () => {
        try {
          const response = await fetch(`${CDN_URL}?sessionId=${encodeURIComponent(sessionId)}`, {
            headers: { accept: 'application/json' },
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          applyCdn(data);
        } catch (failure) {
          setCdnStatus(failure instanceof Error ? failure.message : String(failure));
        }
      }, [applyCdn, sessionId]);

      const toggleWindow = React.useCallback(
        (event) => {
          const next = !open;
          setOpen(next);
          if (next) {
            if (savedGeometry === null) {
              const base = defaultGeometry();
              const button = event !== undefined ? event.currentTarget : null;
              const card = button !== null && typeof button.closest === 'function' ? button.closest('[data-composer-card]') : null;
              if (card !== null) {
                const rect = card.getBoundingClientRect();
                if (Number.isFinite(rect.top) && rect.width > 0) {
                  base.left = Math.round(rect.left + rect.width / 2 - base.width / 2);
                  base.top = Math.round(rect.top - base.height - 12);
                }
              }
              const clamped = clampGeometry(base);
              geometryRef.current = clamped;
              setGeometry(clamped);
            }
            void load({});
          }
        },
        [load, open],
      );

      React.useEffect(() => {
        savedGeometry = geometry;
      }, [geometry]);

      React.useEffect(() => {
        setRenaming(false);
        setConfirmDelete(false);
      }, [selectedId]);

      React.useEffect(() => {
        setConfirmBatchDelete(false);
      }, [selectedIds]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onResize = () => {
          const clamped = clampGeometry(geometryRef.current);
          geometryRef.current = clamped;
          setGeometry(clamped);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, [open]);

      React.useEffect(() => {
        if (!open || !accountOpen) return undefined;
        void loadAccount({ silent: true });
        const timer = window.setInterval(() => void loadAccount({ silent: true }), 2000);
        return () => window.clearInterval(timer);
      }, [accountOpen, loadAccount, open]);

      React.useEffect(() => {
        if (!open) return undefined;
        void loadReferences();
        void loadCdn();
        return undefined;
      }, [loadCdn, loadReferences, open]);

      React.useEffect(() => {
        if (!open) return undefined;
        const timer = window.setInterval(() => {
          if (!busy) void load({ silent: true });
        }, REFRESH_MS);
        return () => window.clearInterval(timer);
      }, [busy, load, open]);

      React.useEffect(() => {
        return () => {
          if (noticeTimer.current !== 0) window.clearTimeout(noticeTimer.current);
        };
      }, []);

      React.useEffect(() => {
        if (!open) return undefined;
        const frame = window.requestAnimationFrame(() => {
          if (generateOpen && promptRef.current !== null) promptRef.current.focus();
        });
        return () => window.cancelAnimationFrame(frame);
      }, [generateOpen, open]);

      const beginDrag = (event) => {
        if (event.button !== 0) return;
        if (event.target !== null && typeof event.target.closest === 'function' && event.target.closest('button') !== null) return;
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const origin = geometryRef.current;
        const pointerId = event.pointerId;
        setDragging(true);
        const node = event.currentTarget;
        try {
          node.setPointerCapture(pointerId);
        } catch {}
        const move = (moveEvent) => {
          const next = clampGeometry({
            ...origin,
            left: origin.left + (moveEvent.clientX - startX),
            top: origin.top + (moveEvent.clientY - startY),
          });
          geometryRef.current = next;
          setGeometry(next);
        };
        const finish = () => {
          setDragging(false);
          try {
            node.releasePointerCapture(pointerId);
          } catch {}
          node.removeEventListener('pointermove', move);
          node.removeEventListener('pointerup', finish);
          node.removeEventListener('pointercancel', finish);
        };
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', finish);
        node.addEventListener('pointercancel', finish);
      };

      const generate = async () => {
        const prompt = draft.trim();
        if (prompt === '' || busy) return;
        setBusy(true);
        setError('');
        setNotice('');
        try {
          const response = await fetch(GENERATE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sessionId, prompt, size, references: references.map((reference) => reference.path) }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          const generated = Array.isArray(data.images) ? data.images : [];
          setDraft('');
          setGenerateOpen(false);
          clearReferences();
          await load({});
          if (generated.length > 0 && typeof generated[0].id === 'string') setSelectedId(generated[0].id);
          showNotice(t('generated', { count: String(generated.length) }));
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setBusy(false);
        }
      };

      const copyRelative = async (image) => {
        if (await copyText(image.relPath ?? '')) showNotice(t('copied'));
      };

      const copyPath = async (image) => {
        if (await copyText(image.path ?? '')) showNotice(t('copied'));
      };

      const copyMarkdown = async (image) => {
        const label = String(image.name ?? 'codex image').replace(/[[\]]/g, '');
        if (await copyText(`![${label}](${image.relPath ?? image.path ?? ''})`)) showNotice(t('copied'));
      };

      const closeDetail = () => {
        setSelectedId('');
        setRenaming(false);
        setConfirmDelete(false);
      };

      const importAuthFile = async (file) => {
        if (file === undefined || file === null) return;
        if (typeof file.size === 'number' && file.size > 256 * 1024) {
          setAccountError(t('importTooLarge'));
          return;
        }
        setAccountBusy(true);
        setAccountError('');
        try {
          const content = await file.text();
          const response = await fetch(IMPORT_AUTH_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ content }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          applyAccount(data);
          showNotice(t('authImported'));
        } catch (failure) {
          setAccountError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setAccountBusy(false);
          if (authFileRef.current !== null) authFileRef.current.value = '';
        }
      };

      const describeProxyTest = (data) => {
        if (data.ok === true) return t('proxyReachable', { code: typeof data.code === 'string' ? data.code : '' });
        if (data.blocked === true) return t('proxyBlocked', { code: typeof data.code === 'string' ? data.code : '' });
        return `${t('proxyFailed')}: ${typeof data.message === 'string' ? data.message : String(data.code ?? '')}`;
      };

      const requestProxyTest = async (url) => {
        const response = await fetch(PROXY_TEST_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
        return data;
      };

      const saveProxy = async () => {
        setAccountBusy(true);
        setAccountError('');
        setProxyStatus('');
        try {
          const response = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ url: proxyDraft.trim() }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          applyAccount(data);
          setProxyDraft(typeof data.proxy === 'string' ? data.proxy : '');
          showNotice(t('proxySaved'));
          if (typeof data.proxy === 'string' && data.proxy !== '') {
            setProxyStatus(describeProxyTest(await requestProxyTest(data.proxy)));
          }
        } catch (failure) {
          setAccountError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setAccountBusy(false);
        }
      };

      const testCurrentProxy = async () => {
        setAccountBusy(true);
        setAccountError('');
        setProxyStatus('');
        try {
          setProxyStatus(describeProxyTest(await requestProxyTest(proxyDraft.trim())));
        } catch (failure) {
          setAccountError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setAccountBusy(false);
        }
      };

      const clearProxy = async () => {
        setAccountBusy(true);
        setAccountError('');
        try {
          const response = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ url: '' }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          applyAccount(data);
          setProxyDraft('');
          setProxyStatus(t('proxyDirect'));
          showNotice(t('proxySaved'));
        } catch (failure) {
          setAccountError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setAccountBusy(false);
        }
      };

      const addReferences = async (files) => {
        const list = Array.from(files ?? []).slice(0, Math.max(0, 4 - references.length));
        if (list.length === 0) return;
        setReferenceBusy(true);
        setError('');
        try {
          for (const file of list) {
            if (typeof file.size === 'number' && file.size > 8 * 1024 * 1024) throw new Error(t('referenceTooLarge'));
            const data = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error('could not read the reference image'));
              reader.readAsDataURL(file);
            });
            const response = await fetch(REFERENCE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ sessionId, name: file.name, data }),
            });
            const body = await readJson(response);
            if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : `HTTP ${response.status}`);
            setReferences((current) => (current.some((item) => item.path === body.path)
              ? current
              : [...current, { name: file.name, path: body.path, preview: fileUrl(body.path, sessionId) }]));
          }
          await loadReferences();
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setReferenceBusy(false);
          if (referenceInputRef.current !== null) referenceInputRef.current.value = '';
        }
      };

      const removeReference = (index) => {
        setReferences((current) => current.filter((_item, position) => position !== index));
      };

      const clearReferences = () => {
        setReferences([]);
      };

      const toggleReference = (item) => {
        setReferences((current) => {
          if (current.some((reference) => reference.path === item.id)) {
            return current.filter((reference) => reference.path !== item.id);
          }
          if (current.length >= 4) {
            setError(t('referenceLimit'));
            return current;
          }
          return [...current, { name: item.name, path: item.id, preview: fileUrl(item.id, sessionId) }];
        });
      };

      const clearSelection = () => {
        setSelectedIds([]);
        setConfirmBatchDelete(false);
      };

      const toggleSelection = (id) => {
        setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
      };

      const beginMarquee = (event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (target !== null && typeof target.closest === 'function') {
          if (target.closest('.cxi-batch') !== null) return;
          const control = target.closest('button');
          if (control !== null && control.dataset.workId === undefined) return;
        }
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        const state = { x: event.clientX, y: event.clientY, additive, base: additive ? selectedIds : [], moved: false };
        dragRef.current = state;
        const move = (moveEvent) => {
          if (dragRef.current !== state) return;
          const dx = Math.abs(moveEvent.clientX - state.x);
          const dy = Math.abs(moveEvent.clientY - state.y);
          if (!state.moved && dx < 4 && dy < 4) return;
          state.moved = true;
          const rect = { left: Math.min(state.x, moveEvent.clientX), top: Math.min(state.y, moveEvent.clientY), width: dx, height: dy };
          setDragRect(rect);
          const container = bodyRef.current;
          if (container === null) return;
          const hits = [];
          for (const card of container.querySelectorAll('[data-work-id]')) {
            const bounds = card.getBoundingClientRect();
            if (bounds.left < rect.left + rect.width && bounds.right > rect.left && bounds.top < rect.top + rect.height && bounds.bottom > rect.top) {
              hits.push(card.dataset.workId);
            }
          }
          setSelectedIds(state.additive ? Array.from(new Set([...state.base, ...hits])) : hits);
        };
        const finish = () => {
          dragRef.current = null;
          setDragRect(null);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', finish);
          if (state.moved) {
            suppressClickRef.current = true;
            window.setTimeout(() => {
              suppressClickRef.current = false;
            }, 0);
          } else if (target !== null && typeof target.closest === 'function' && target.closest('[data-work-id]') === null) {
            clearSelection();
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
      };

      const batchToReference = async () => {
        const ids = [...selectedIds];
        if (ids.length === 0) return;
        setBatchBusy(true);
        setError('');
        try {
          const converted = [];
          for (const id of ids) {
            const response = await fetch(REFERENCE_FROM_WORK_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ sessionId, id }),
            });
            const data = await readJson(response);
            if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
            converted.push(data.reference);
          }
          await loadReferences();
          setReferences((current) => {
            const next = [...current];
            for (const reference of converted) {
              if (next.length >= 4) break;
              if (!next.some((item) => item.path === reference.id)) {
                next.push({ name: reference.name, path: reference.id, preview: fileUrl(reference.id, sessionId) });
              }
            }
            return next;
          });
          clearSelection();
          setTab('references');
          showNotice(t('batchReferenceDone', { count: String(converted.length) }));
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setBatchBusy(false);
        }
      };

      const batchDelete = async () => {
        if (selectedIds.length === 0) return;
        if (!confirmBatchDelete) {
          setConfirmBatchDelete(true);
          return;
        }
        const ids = [...selectedIds];
        setBatchBusy(true);
        setError('');
        try {
          for (const id of ids) {
            const response = await fetch(DELETE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ sessionId, id }),
            });
            const data = await readJson(response);
            if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          }
          closeDetail();
          clearSelection();
          await load({});
          showNotice(t('batchDeleted', { count: String(ids.length) }));
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setBatchBusy(false);
        }
      };

      const setCdnEnabled = async (enabled) => {
        setCdnBusy(true);
        setCdnStatus('');
        try {
          const response = await fetch(CDN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              sessionId,
              enabled,
              port: Number(cdnPort),
              publicBaseUrl: cdnBase.trim(),
            }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          applyCdn(data);
          setCdnPort(String(data.port));
          setCdnBase(typeof data.publicBaseUrl === 'string' ? data.publicBaseUrl : '');
          setCdnStatus(enabled ? t('cdnRunning', { port: String(data.port) }) : t('cdnStopped'));
        } catch (failure) {
          setCdnStatus(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setCdnBusy(false);
        }
      };

      const copyCdnUrl = async () => {
        if (cdn === null || cdn.enabled !== true || typeof cdn.urlBase !== 'string' || cdn.urlBase === '') {
          showNotice(t('cdnDisabledNotice'));
          return;
        }
        if (await copyText(cdn.urlBase)) showNotice(t('copied'));
      };

      const copyPublicLink = async (image) => {
        if (cdn === null || cdn.enabled !== true || typeof cdn.urlBase !== 'string' || cdn.urlBase === '') {
          showNotice(t('cdnDisabledNotice'));
          return;
        }
        const relative = String(image.relPath ?? '').split('/').map(encodeURIComponent).join('/');
        if (await copyText(`${cdn.urlBase}/${relative}`)) showNotice(t('copied'));
      };

      const convertToReference = async (image) => {
        try {
          const response = await fetch(REFERENCE_FROM_WORK_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sessionId, id: image.id }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          const reference = data.reference;
          setReferences((current) => {
            if (current.some((item) => item.path === reference.id)) return current;
            if (current.length >= 4) {
              setError(t('referenceLimit'));
              return current;
            }
            return [...current, { name: reference.name, path: reference.id, preview: fileUrl(reference.id, sessionId) }];
          });
          closeDetail();
          setTab('references');
          await loadReferences();
          showNotice(t('toReferenceDone'));
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      };

      const deleteLibraryReference = async (item) => {
        try {
          const response = await fetch(REFERENCE_DELETE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sessionId, id: item.id }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          setReferences((current) => current.filter((reference) => reference.path !== item.id));
          await loadReferences();
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      };

      const startCodexLogin = async (method = 'device') => {
        setAccountBusy(true);
        setAccountError('');
        try {
          const response = await fetch(LOGIN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ method }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          applyAccount(data);
        } catch (failure) {
          setAccountError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setAccountBusy(false);
        }
      };

      const cancelCodexLogin = async () => {
        setAccountBusy(true);
        try {
          const response = await fetch(LOGIN_CANCEL_URL, { method: 'POST', headers: { accept: 'application/json' } });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          applyAccount(data);
        } catch (failure) {
          setAccountError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setAccountBusy(false);
        }
      };

      const completeCodexLogin = async () => {
        const url = callbackDraft.trim();
        if (url === '' || accountBusy) return;
        setAccountBusy(true);
        setAccountError('');
        try {
          const response = await fetch(LOGIN_CALLBACK_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ url }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          applyAccount(data);
          setCallbackDraft('');
          showNotice(t('signedIn'));
        } catch (failure) {
          setAccountError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setAccountBusy(false);
        }
      };

      const logoutCodex = async () => {
        setAccountBusy(true);
        setAccountError('');
        try {
          const response = await fetch(LOGOUT_URL, { method: 'POST', headers: { accept: 'application/json' } });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          applyAccount(data);
          showNotice(t('logoutDone'));
        } catch (failure) {
          setAccountError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setAccountBusy(false);
        }
      };

      const renameImage = async (image) => {
        const raw = renameDraft.trim();
        if (raw === '') return;
        if (raw.includes('/') || raw.includes('\\')) {
          setError(t('renameNoSlash'));
          return;
        }
        const extension = (String(image.name).match(/\.[^.]+$/) ?? [''])[0];
        const name = /\.[a-z0-9]+$/i.test(raw) ? raw : `${raw}${extension}`;
        const directory = String(image.relPath ?? '').split('/').slice(0, -1).join('/');
        const target = directory === '' ? name : `${directory}/${name}`;
        try {
          const response = await fetch(RENAME_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sessionId, id: image.id, target }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          setRenaming(false);
          if (typeof data.relPath === 'string') setSelectedId(data.relPath);
          await load({});
          showNotice(t('renamed', { name: typeof data.relPath === 'string' ? data.relPath : name }));
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      };

      const deleteImage = async (image) => {
        if (!confirmDelete) {
          setConfirmDelete(true);
          return;
        }
        try {
          const response = await fetch(DELETE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sessionId, id: image.id }),
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
          setConfirmDelete(false);
          closeDetail();
          await load({});
          showNotice(t('deleted', { name: image.name }));
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      };

      if (!open) {
        const label = t('toggle');
        return h(
          'button',
          {
            type: 'button',
            className: 'cxi-toggle',
            title: label,
            'aria-label': label,
            'aria-pressed': 'false',
            ref: toggleRef,
            onClick: toggleWindow,
          },
          h(PictureIcon),
        );
      }

      const heading = t('title');
      const busyLine = busy
        ? h('div', { className: 'cxi-busy', role: 'status' }, [
            h('span', { key: 'spinner', className: 'cxi-spinner', 'aria-hidden': 'true' }),
            h('span', { key: 'text' }, t('generating')),
          ])
        : null;

      const generatePanel = generateOpen
        ? h('div', { className: 'cxi-gen' }, [
            h('div', { key: 'row', className: 'cxi-gen-row' }, [
              h('textarea', {
                key: 'prompt',
                ref: promptRef,
                className: 'cxi-textarea',
                value: draft,
                placeholder: t('promptPlaceholder'),
                'aria-label': t('promptLabel'),
                spellCheck: false,
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void generate();
                  }
                },
              }),
              h('div', { key: 'side', className: 'cxi-side' }, [
                h(
                  'select',
                  {
                    key: 'size',
                    className: 'cxi-select',
                    value: size,
                    'aria-label': t('size'),
                    title: t('size'),
                    onChange: (event) => setSize(event.target.value),
                  },
                  SIZES.map((value) => h('option', { key: value, value }, value)),
                ),
                h(
                  'button',
                  {
                    key: 'go',
                    type: 'button',
                    className: 'cxi-primary',
                    disabled: busy || referenceBusy || draft.trim() === '' || !canGenerate,
                    onClick: () => void generate(),
                  },
                  t('generate'),
                ),
              ]),
            ]),
            h('div', { key: 'refs', className: 'cxi-refs' }, [
              h('button', {
                key: 'add',
                type: 'button',
                className: 'cxi-btn',
                disabled: busy || referenceBusy || references.length >= 4,
                onClick: () => {
                  setTab('references');
                  setSelectedId('');
                  void loadReferences();
                },
              }, `＋ ${t('addReference')}`),
              ...references.map((reference, index) => h('span', { key: `${reference.path}-${index}`, className: 'cxi-ref-chip' }, [
                h('img', { key: 'thumb', className: 'cxi-ref-thumb', src: reference.preview, alt: reference.name }),
                h('span', { key: 'name', className: 'cxi-ref-name', title: reference.name }, reference.name),
                h('button', {
                  key: 'remove',
                  type: 'button',
                  className: 'cxi-ref-remove',
                  'aria-label': t('removeReference'),
                  title: t('removeReference'),
                  onClick: () => removeReference(index),
                }, '×'),
              ])),
            ]),
            h('div', { key: 'ref-hint', className: 'cxi-hint' }, t('referenceHint')),
            h('div', { key: 'hint', className: 'cxi-hint' }, t('generateHint', { dir: relative === '' ? t('directory') : relative })),
            busyLine,
          ])
        : null;

      const batchBar = selectedIds.length === 0
        ? null
        : h('div', { key: 'batch', className: 'cxi-batch' }, [
            h('span', { key: 'count', className: 'cxi-batch-count' }, t('batchSelected', { count: String(selectedIds.length) })),
            h('button', {
              key: 'reference',
              type: 'button',
              className: 'cxi-btn',
              disabled: batchBusy,
              onClick: () => void batchToReference(),
            }, t('batchReference')),
            h('button', {
              key: 'delete',
              type: 'button',
              className: 'cxi-btn cxi-danger',
              disabled: batchBusy,
              onClick: () => void batchDelete(),
            }, confirmBatchDelete ? t('confirmDelete') : t('batchDelete')),
            h('button', {
              key: 'clear',
              type: 'button',
              className: 'cxi-btn',
              onClick: clearSelection,
            }, t('cancel')),
          ]);

      const body = h(
        'div',
        { key: 'body', ref: bodyRef, className: 'cxi-body', onPointerDown: beginMarquee, title: t('dragSelectHint') },
        [
          batchBar,
          images.length === 0
          ? h('div', { className: 'cxi-empty' }, [
              h(PictureIcon, { key: 'icon' }),
              h('div', { key: 'title', className: 'cxi-empty-title' }, loading ? t('loading') : t('emptyTitle')),
              h('div', { key: 'body', className: 'cxi-empty-body' }, canGenerate ? t('emptyBody') : t('notConfigured')),
              h(
                'code',
                { key: 'dir', className: 'cxi-sources', title: project === '' ? '' : `${t('project')}: ${project}` },
                [relative === '' ? '—' : relative, project === '' ? null : h('br', { key: 'br' }), project],
              ),
            ])
          : h(
              'div',
              { className: 'cxi-grid' },
              images.map((image) =>
                h(
                  'button',
                  {
                    key: image.id,
                    type: 'button',
                    className: 'cxi-card',
                    title: t('openHint'),
                    'aria-label': `${image.name} — ${t('openHint')}`,
                    'data-work-id': image.id,
                    'data-selected': selectedIds.includes(image.id) ? 'true' : 'false',
                    'aria-pressed': selectedIds.includes(image.id),
                    onClick: (event) => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      if (event.ctrlKey || event.metaKey || event.shiftKey) {
                        toggleSelection(image.id);
                        return;
                      }
                      setSelectedId(image.id);
                      setAccountOpen(false);
                    },
                  },
                  [
                    h('img', {
                      key: 'img',
                      className: 'cxi-thumb',
                      src: fileUrl(image.id, sessionId),
                      alt: image.name,
                      loading: 'lazy',
                      decoding: 'async',
                      draggable: false,
                    }),
                    h('span', { key: 'label', className: 'cxi-card-label' }, [
                      h('span', { key: 'name', className: 'cxi-card-name' }, image.name),
                      h('span', { key: 'meta', className: 'cxi-card-meta' }, `${formatTime(image.createdAt)} · ${formatBytes(image.bytes)}`),
                    ]),
                    selectedIds.includes(image.id) ? h('span', { key: 'check', className: 'cxi-card-check', 'aria-hidden': 'true' }, '✓') : null,
                  ],
                ),
              ),
            ),
        ],
      );

      const detail = selected === null
        ? null
        : h('div', { className: 'cxi-detail', role: 'group', 'aria-label': selected.name }, [
            h('div', { key: 'head', className: 'cxi-detail-head' }, [
              h(
                'button',
                {
                  key: 'back',
                  type: 'button',
                  className: 'cxi-ghost',
                  onClick: closeDetail,
                  title: t('back'),
                },
                `← ${t('back')}`,
              ),
              h('span', { key: 'name', className: 'cxi-detail-name', title: selected.path }, selected.name),
              h(
                'button',
                {
                  key: 'close',
                  type: 'button',
                  className: 'cxi-ghost',
                  'aria-label': t('close'),
                  title: t('close'),
                  onClick: closeDetail,
                },
                '✕',
              ),
            ]),
            h(
              'div',
              { key: 'image', className: 'cxi-detail-body' },
              h('img', {
                className: 'cxi-detail-image',
                src: fileUrl(selected.id, sessionId),
                alt: selected.name,
                decoding: 'async',
              }),
            ),
            h('div', { key: 'foot', className: 'cxi-detail-foot' }, [
              h('div', { key: 'meta', className: 'cxi-detail-meta', title: selected.path }, [
                h('span', { key: 'rel' }, selected.relPath ?? ''),
                h('span', { key: 'time' }, `${t('created')}: ${formatTime(selected.createdAt)}`),
                h('span', { key: 'bytes' }, `${t('bytes')}: ${formatBytes(selected.bytes)}`),
              ]),
              typeof selected.prompt === 'string' && selected.prompt !== ''
                ? h('p', { key: 'prompt', className: 'cxi-detail-prompt', title: selected.prompt }, `${t('promptLabel')}: ${selected.prompt}`)
                : null,
              renaming
                ? h('div', { key: 'rename', className: 'cxi-rename' }, [
                    h('input', {
                      key: 'input',
                      className: 'cxi-input',
                      value: renameDraft,
                      autoFocus: true,
                      spellCheck: false,
                      'aria-label': t('rename'),
                      onChange: (event) => setRenameDraft(event.target.value),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void renameImage(selected);
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          setRenaming(false);
                        }
                      },
                    }),
                    h('button', { key: 'save', type: 'button', className: 'cxi-btn', onClick: () => void renameImage(selected) }, t('save')),
                    h('button', { key: 'cancel', type: 'button', className: 'cxi-btn', onClick: () => setRenaming(false) }, t('cancel')),
                  ])
                : null,
              h('div', { key: 'actions', className: 'cxi-actions' }, [
                h('button', { key: 'copy-rel', type: 'button', className: 'cxi-btn', onClick: () => void copyRelative(selected) }, t('copyRelative')),
                h('button', { key: 'copy-md', type: 'button', className: 'cxi-btn', onClick: () => void copyMarkdown(selected) }, t('copyMarkdown')),
                h('button', { key: 'copy-path', type: 'button', className: 'cxi-btn', onClick: () => void copyPath(selected) }, t('copyPath')),
                h('button', { key: 'copy-cdn', type: 'button', className: 'cxi-btn', onClick: () => void copyPublicLink(selected) }, t('copyPublicLink')),
                h('button', {
                  key: 'reference',
                  type: 'button',
                  className: 'cxi-btn',
                  onClick: () => void convertToReference(selected),
                }, t('toReference')),
                h('button', {
                  key: 'rename',
                  type: 'button',
                  className: 'cxi-btn',
                  onClick: () => {
                    setRenaming(true);
                    setRenameDraft(selected.name);
                  },
                }, t('rename')),
                h('button', {
                  key: 'delete',
                  type: 'button',
                  className: 'cxi-btn cxi-danger',
                  onClick: () => void deleteImage(selected),
                }, confirmDelete ? t('confirmDelete') : t('delete')),
                h(
                  'a',
                  {
                    key: 'download',
                    className: 'cxi-btn',
                    href: fileUrl(selected.id, sessionId, true),
                    download: selected.name,
                  },
                  t('download'),
                ),
              ]),
            ]),
          ]);

      const projectName = project === '' ? '' : project.split(/[\\/]/).filter(Boolean).pop();
      const windowTitle = projectName === '' ? heading : `${heading} · ${projectName}`;
      const footText = error !== ''
        ? error
        : notice !== ''
          ? notice
          : tab === 'references'
            ? t('selectedCount', { count: String(references.length) })
            : relative !== ''
              ? `${t('directory')}: ${relative}`
              : '';

      const signedIn = account !== null && account.loggedIn === true;
      const loginPending = login.phase === 'starting' || login.phase === 'pending';
      const accountRows = [];
      if (signedIn) {
        if (typeof account.workspaceName === 'string' && account.workspaceName !== '') accountRows.push(['workspace', account.workspaceName]);
        if (typeof account.subscriptionUntil === 'string' && account.subscriptionUntil !== '') accountRows.push(['planExpires', formatTime(account.subscriptionUntil)]);
      }
      const quotaWindows = [];
      if (rateLimits !== null) {
        const addWindow = (key, window) => {
          if (window !== null && typeof window === 'object' && Number.isFinite(window.usedPercent)) quotaWindows.push({ key, ...window });
        };
        addWindow('primary', rateLimits.primary);
        addWindow('secondary', rateLimits.secondary);
      }
      const quotaLabel = (minutes) => {
        if (minutes === 10080) return t('quotaWeekly');
        if (minutes === 300) return t('quotaFiveHour');
        if (typeof minutes === 'number' && minutes > 0) return t('quotaMinutes', { mins: String(minutes) });
        return t('quotaTitle');
      };

      const accountPanel = accountOpen
        ? h('div', { className: 'cxi-account', role: 'group', 'aria-label': t('accountTitle') }, [
            h('div', { key: 'head', className: 'cxi-account-head' }, [
              h('button', { key: 'back', type: 'button', className: 'cxi-ghost', onClick: () => setAccountOpen(false) }, `← ${t('back')}`),
              h('span', { key: 'title', className: 'cxi-account-title' }, t('accountTitle')),
              h('button', {
                key: 'refresh',
                type: 'button',
                className: 'cxi-ghost',
                title: t('refresh'),
                'aria-label': t('refresh'),
                disabled: accountBusy,
                onClick: () => void loadAccount({}),
              }, '↻'),
              h('button', {
                key: 'close',
                type: 'button',
                className: 'cxi-ghost',
                title: t('close'),
                'aria-label': t('close'),
                onClick: () => setAccountOpen(false),
              }, '✕'),
            ]),
            h(
              'div',
              { key: 'body', className: 'cxi-account-body' },
              [
                h('input', {
                  key: 'auth-file',
                  ref: authFileRef,
                  type: 'file',
                  accept: '.json,application/json',
                  style: { display: 'none' },
                  onChange: (event) => {
                    const file = event.target.files !== null && event.target.files.length > 0 ? event.target.files[0] : undefined;
                    void importAuthFile(file);
                  },
                }),
                signedIn
                ? h('div', { className: 'cxi-account-card' }, [
                    h('div', { key: 'identity', className: 'cxi-account-identity' }, [
                      h('div', { key: 'avatar', className: 'cxi-avatar', 'aria-hidden': 'true' }, String(account.email ?? account.name ?? '?').slice(0, 1)),
                      h('div', { key: 'name', className: 'cxi-account-name' }, [
                        h('div', { key: 'email', className: 'cxi-account-email', title: account.email ?? '' }, account.email ?? account.apiKeyHint ?? t('signedIn')),
                        h('div', { key: 'mode', className: 'cxi-account-sub' }, account.mode === 'apiKey' ? t('apiKeyMode') : t('chatgptMode')),
                      ]),
                    ]),
                    typeof account.plan === 'string' && account.plan !== ''
                      ? h('span', { key: 'plan', className: 'cxi-badge' }, `${t('plan')}: ${account.plan}`)
                      : null,
                    accountRows.length === 0
                      ? null
                      : h('div', { key: 'grid', className: 'cxi-account-grid' }, accountRows.flatMap(([label, value]) => [
                          h('span', { key: `${label}-label`, className: 'cxi-account-label' }, t(label)),
                          h('span', { key: `${label}-value`, className: 'cxi-account-value' }, value),
                        ])),
                    h('div', { key: 'quota', className: 'cxi-quota-section' }, [
                      h('div', { key: 'title', className: 'cxi-quota-title' }, t('quotaTitle')),
                      ...quotaWindows.map((quota) => {
                        const used = Math.max(0, Math.min(100, quota.usedPercent));
                        const remaining = 100 - used;
                        const exhausted = used >= 100;
                        const tone = exhausted ? 'is-danger' : used >= 80 ? 'is-warning' : '';
                        const fill = used <= 0 ? 0 : Math.max(2, used);
                        return h('div', { key: quota.key, className: 'cxi-quota' }, [
                          h('div', { key: 'head', className: 'cxi-quota-head' }, [
                            h('span', { key: 'label' }, quotaLabel(quota.windowDurationMins)),
                            h('span', { key: 'percent', className: exhausted ? 'cxi-quota-state-danger' : undefined }, exhausted ? t('quotaExhausted') : t('quotaRemaining', { percent: String(remaining) })),
                          ]),
                          h('div', {
                            key: 'bar',
                            className: 'cxi-quota-bar',
                            role: 'progressbar',
                            'aria-valuemin': 0,
                            'aria-valuemax': 100,
                            'aria-valuenow': used,
                            'aria-label': `${quotaLabel(quota.windowDurationMins)} ${t('quotaUsed', { percent: String(used) })}`,
                          }, h('div', {
                            key: 'fill',
                            className: `cxi-quota-fill ${tone}`.trim(),
                            style: { width: `${fill}%` },
                          })),
                          h('div', { key: 'meta', className: 'cxi-quota-meta' }, [
                            h('span', { key: 'used' }, t('quotaUsed', { percent: String(used) })),
                            typeof quota.resetsAt === 'number'
                              ? h('span', { key: 'reset' }, t('quotaResets', { time: formatTime(new Date(quota.resetsAt * 1000).toISOString()) }))
                              : null,
                          ]),
                        ]);
                      }),
                      quotaWindows.length === 0
                        ? h('div', { key: 'none', className: 'cxi-quota-note' }, t('quotaUnavailable'))
                        : null,
                      rateLimits !== null && rateLimits.credits !== null && typeof rateLimits.credits === 'object' && rateLimits.credits.unlimited === true
                        ? h('div', { key: 'unlimited', className: 'cxi-quota-note' }, t('quotaUnlimited'))
                        : null,
                      rateLimits !== null && rateLimits.credits !== null && typeof rateLimits.credits === 'object' && rateLimits.credits.hasCredits === true && rateLimits.credits.unlimited !== true && typeof rateLimits.credits.balance === 'string'
                        ? h('div', { key: 'extra', className: 'cxi-quota-note' }, t('quotaExtra', { balance: rateLimits.credits.balance }))
                        : null,
                      rateLimits !== null && typeof rateLimits.resetCredits === 'number' && rateLimits.resetCredits > 0
                        ? h('div', { key: 'reset-credits', className: 'cxi-quota-note' }, t('quotaResetCredits', { count: String(rateLimits.resetCredits) }))
                        : null,
                    ]),
                    provider !== null && provider.provider !== 'openai'
                      ? h('div', { key: 'warn', className: 'cxi-account-warn' }, t('providerWarning', { provider: provider.provider }))
                      : null,
                    accountError !== ''
                      ? h('div', { key: 'error', className: 'cxi-account-error' }, accountError)
                      : null,
                    h('div', { key: 'actions', className: 'cxi-account-actions' }, [
                      h('button', {
                        key: 'import',
                        type: 'button',
                        className: 'cxi-btn',
                        disabled: accountBusy,
                        onClick: () => {
                          if (authFileRef.current !== null) authFileRef.current.click();
                        },
                      }, t('importAuth')),
                      h('button', {
                        key: 'out',
                        type: 'button',
                        className: 'cxi-btn cxi-danger',
                        disabled: accountBusy,
                        onClick: () => void logoutCodex(),
                      }, t('signOut')),
                    ]),
                  ])
                : h('div', { className: 'cxi-account-card' }, [
                    h('div', { key: 'empty', className: 'cxi-account-empty' }, [
                      h(AccountIcon, { key: 'icon' }),
                      h('div', { key: 'title', className: 'cxi-account-email' }, t('signedOut')),
                      h('p', { key: 'body', className: 'cxi-account-hint' }, t('signedOutBody')),
                      loginPending ? h('div', { key: 'waiting', className: 'cxi-account-sub' }, t('waitingAuth')) : null,
                      loginPending && login.method === 'device' && typeof login.userCode === 'string' && login.userCode !== ''
                        ? h('div', { key: 'device', className: 'cxi-device' }, [
                            h('span', { key: 'label', className: 'cxi-device-label' }, t('deviceCode')),
                            h('code', { key: 'code', className: 'cxi-device-code' }, login.userCode),
                            h('p', { key: 'hint', className: 'cxi-account-hint' }, t('deviceHint')),
                          ])
                        : null,
                      loginPending && login.url !== ''
                        ? h('a', { key: 'url', className: 'cxi-auth-link', href: login.url, target: '_blank', rel: 'noreferrer noopener', title: login.url }, login.url)
                        : null,
                      loginPending
                        ? h('div', { key: 'pending', className: 'cxi-account-actions' }, [
                            login.url !== ''
                              ? h('a', { key: 'open', className: 'cxi-primary', href: login.url, target: '_blank', rel: 'noreferrer noopener' }, t('openAuth'))
                              : null,
                            login.url !== ''
                              ? h('button', {
                                  key: 'copy',
                                  type: 'button',
                                  className: 'cxi-btn',
                                  onClick: () => {
                                    void copyText(login.url).then((ok) => {
                                      if (ok) showNotice(t('copied'));
                                    });
                                  },
                                }, t('copyAuth'))
                              : null,
                            login.method === 'device' && typeof login.userCode === 'string' && login.userCode !== ''
                              ? h('button', {
                                  key: 'copy-code',
                                  type: 'button',
                                  className: 'cxi-btn',
                                  onClick: () => {
                                    void copyText(login.userCode).then((ok) => {
                                      if (ok) showNotice(t('copied'));
                                    });
                                  },
                                }, t('copyCode'))
                              : null,
                            h('button', {
                              key: 'cancel',
                              type: 'button',
                              className: 'cxi-btn',
                              disabled: accountBusy,
                              onClick: () => void cancelCodexLogin(),
                            }, t('cancel')),
                          ])
                        : h('div', { key: 'actions', className: 'cxi-account-actions' }, [
                            h('button', {
                              key: 'device',
                              type: 'button',
                              className: 'cxi-primary',
                              disabled: accountBusy,
                              onClick: () => void startCodexLogin('device'),
                            }, accountBusy ? t('signingIn') : t('deviceLogin')),
                            h('button', {
                              key: 'browser',
                              type: 'button',
                              className: 'cxi-btn',
                              disabled: accountBusy,
                              onClick: () => void startCodexLogin('browser'),
                            }, t('browserLogin')),
                          ]),
                      h('p', { key: 'hint', className: 'cxi-account-hint' }, t('loginHint')),
                      h('div', { key: 'import', className: 'cxi-import' }, [
                        h('button', {
                          key: 'import-button',
                          type: 'button',
                          className: 'cxi-btn',
                          disabled: accountBusy,
                          onClick: () => {
                            if (authFileRef.current !== null) authFileRef.current.click();
                          },
                        }, t('importAuth')),
                        h('p', { key: 'import-hint', className: 'cxi-account-hint' }, t('importHint')),
                      ]),
                      loginPending && login.method === 'browser'
                        ? h('div', { key: 'callback', className: 'cxi-callback' }, [
                            h('p', { key: 'callback-hint', className: 'cxi-account-hint' }, t('callbackHint')),
                            h('div', { key: 'callback-row', className: 'cxi-rename' }, [
                              h('input', {
                                key: 'callback-input',
                                className: 'cxi-input',
                                value: callbackDraft,
                                placeholder: t('callbackPlaceholder'),
                                spellCheck: false,
                                'aria-label': t('callbackHint'),
                                onChange: (event) => setCallbackDraft(event.target.value),
                                onKeyDown: (event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void completeCodexLogin();
                                  }
                                },
                              }),
                              h('button', {
                                key: 'callback-go',
                                type: 'button',
                                className: 'cxi-btn',
                                disabled: accountBusy || callbackDraft.trim() === '',
                                onClick: () => void completeCodexLogin(),
                              }, t('finishLogin')),
                            ]),
                          ])
                        : null,
                    ]),
                    login.phase === 'error'
                      ? h('div', { key: 'login-error', className: 'cxi-account-error' }, [
                          h('div', { key: 'msg' }, `${t('loginFailed')}: ${login.error}`),
                          login.output !== '' ? h('pre', { key: 'out', className: 'cxi-account-output' }, login.output) : null,
                        ])
                      : null,
                    accountError !== ''
                      ? h('div', { key: 'error', className: 'cxi-account-error' }, accountError)
                      : null,
                  ]),
                h('div', { key: 'proxy', className: 'cxi-proxy' }, [
                  h('button', {
                    key: 'toggle',
                    type: 'button',
                    className: 'cxi-proxy-toggle',
                    'aria-expanded': proxyOpen ? 'true' : 'false',
                    onClick: () => setProxyOpen((current) => !current),
                  }, [
                    h('span', { key: 'title', className: 'cxi-proxy-title' }, t('proxyTitle')),
                    h('span', { key: 'summary', className: 'cxi-proxy-summary', title: proxyDraft.trim() }, proxyDraft.trim() === '' ? t('proxyDirect') : proxyDraft.trim()),
                    h('span', { key: 'chevron', className: 'cxi-proxy-chevron', 'aria-hidden': 'true' }, proxyOpen ? '▾' : '▸'),
                  ]),
                  proxyOpen
                    ? h('div', { key: 'body', className: 'cxi-proxy-body' }, [
                        h('p', { key: 'hint', className: 'cxi-account-hint' }, t('proxyHint')),
                        h('div', { key: 'row', className: 'cxi-rename' }, [
                          h('input', {
                            key: 'input',
                            className: 'cxi-input',
                            value: proxyDraft,
                            placeholder: 'socks5h://127.0.0.1:1080',
                            spellCheck: false,
                            'aria-label': t('proxyTitle'),
                            onChange: (event) => setProxyDraft(event.target.value),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void saveProxy();
                              }
                            },
                          }),
                          h('button', { key: 'save', type: 'button', className: 'cxi-btn', disabled: accountBusy, onClick: () => void saveProxy() }, t('proxySave')),
                          h('button', { key: 'test', type: 'button', className: 'cxi-btn', disabled: accountBusy || proxyDraft.trim() === '', onClick: () => void testCurrentProxy() }, t('proxyTest')),
                          h('button', { key: 'clear', type: 'button', className: 'cxi-btn', disabled: accountBusy, onClick: () => void clearProxy() }, t('proxyClear')),
                        ]),
                        proxyStatus === '' ? null : h('p', { key: 'status', className: 'cxi-account-hint' }, proxyStatus),
                        h('p', { key: 'ssh', className: 'cxi-account-hint' }, t('proxySshHint')),
                      ])
                    : null,
                ]),
                h('div', { key: 'cdn', className: 'cxi-proxy' }, [
                  h('button', {
                    key: 'toggle',
                    type: 'button',
                    className: 'cxi-proxy-toggle',
                    'aria-expanded': cdnOpen ? 'true' : 'false',
                    onClick: () => {
                      setCdnOpen((current) => !current);
                      if (!cdnOpen) void loadCdn();
                    },
                  }, [
                    h('span', { key: 'title', className: 'cxi-proxy-title' }, t('cdnTitle')),
                    h('span', { key: 'summary', className: 'cxi-proxy-summary', title: cdn !== null && cdn.enabled === true ? cdn.baseUrl : '' }, cdn !== null && cdn.enabled === true ? cdn.baseUrl : t('cdnOff')),
                    h('span', { key: 'chevron', className: 'cxi-proxy-chevron', 'aria-hidden': 'true' }, cdnOpen ? '▾' : '▸'),
                  ]),
                  cdnOpen
                    ? h('div', { key: 'body', className: 'cxi-proxy-body' }, [
                        h('p', { key: 'hint', className: 'cxi-account-hint' }, t('cdnHint')),
                        cdn !== null && typeof cdn.publicIp === 'string' && cdn.publicIp !== ''
                          ? h('p', { key: 'ip', className: 'cxi-account-hint' }, t('cdnPublicIp', { ip: cdn.publicIp }))
                          : h('p', { key: 'noip', className: 'cxi-account-hint' }, t('cdnNoPublicIp')),
                        h('div', { key: 'row', className: 'cxi-rename' }, [
                          h('input', {
                            key: 'port',
                            type: 'number',
                            className: 'cxi-input cxi-input-port',
                            value: cdnPort,
                            min: 1024,
                            max: 65535,
                            step: 1,
                            'aria-label': t('cdnPort'),
                            onChange: (event) => setCdnPort(event.target.value),
                          }),
                          h('input', {
                            key: 'base',
                            className: 'cxi-input',
                            value: cdnBase,
                            placeholder: cdn !== null && typeof cdn.autoBaseUrl === 'string' ? cdn.autoBaseUrl : '',
                            spellCheck: false,
                            'aria-label': t('cdnBase'),
                            onChange: (event) => setCdnBase(event.target.value),
                          }),
                        ]),
                        h('div', { key: 'actions', className: 'cxi-account-actions' }, [
                          h('button', { key: 'start', type: 'button', className: 'cxi-primary', disabled: cdnBusy, onClick: () => void setCdnEnabled(true) }, t('cdnStart')),
                          h('button', { key: 'stop', type: 'button', className: 'cxi-btn', disabled: cdnBusy || cdn === null || cdn.enabled !== true, onClick: () => void setCdnEnabled(false) }, t('cdnStop')),
                          h('button', { key: 'copy', type: 'button', className: 'cxi-btn', disabled: cdn === null || cdn.enabled !== true, onClick: () => void copyCdnUrl() }, t('cdnCopy')),
                        ]),
                        cdn !== null && cdn.enabled === true && typeof cdn.urlBase === 'string' && cdn.urlBase !== ''
                          ? h('code', { key: 'url', className: 'cxi-cdn-url', title: cdn.urlBase }, cdn.urlBase)
                          : null,
                        cdnStatus === '' ? null : h('p', { key: 'status', className: 'cxi-account-hint' }, cdnStatus),
                        h('p', { key: 'token', className: 'cxi-account-hint' }, t('cdnTokenHint')),
                      ])
                    : null,
                ]),
              ],
            ),
            h('div', { key: 'foot', className: 'cxi-account-foot', title: codexHome }, `${t('codexHome')}: ${codexHome}`),
          ])
        : null;

      const tabs = h('div', { key: 'tabs', className: 'cxi-tabs' }, [
        h('button', {
          key: 'gallery',
          type: 'button',
          className: 'cxi-tab',
          'data-active': tab === 'gallery' ? 'true' : 'false',
          onClick: () => {
            setTab('gallery');
            setSelectedId('');
          },
        }, `${t('galleryTab')} ${images.length}`),
        h('button', {
          key: 'references',
          type: 'button',
          className: 'cxi-tab',
          'data-active': tab === 'references' ? 'true' : 'false',
          onClick: () => {
            setTab('references');
            setSelectedId('');
            void loadReferences();
          },
        }, `${t('referencesTab')} ${referenceLibrary.length}`),
      ]);

      const referenceBody = h('div', { key: 'refs-body', className: 'cxi-refs-body' }, [
        h('div', { key: 'bar', className: 'cxi-refs-bar' }, [
          h('span', { key: 'info', className: 'cxi-refs-info' }, t('referenceLibraryHint', { count: String(referenceLibrary.length) })),
          h('button', {
            key: 'upload',
            type: 'button',
            className: 'cxi-primary',
            disabled: referenceBusy || references.length >= 4,
            onClick: () => {
              if (referenceInputRef.current !== null) referenceInputRef.current.click();
            },
          }, `＋ ${t('uploadReference')}`),
        ]),
        referenceLoading && referenceLibrary.length === 0
          ? h('div', { key: 'loading', className: 'cxi-empty-body' }, t('loading'))
          : referenceLibrary.length === 0
            ? h('div', { key: 'empty', className: 'cxi-empty' }, [
                h(PictureIcon, { key: 'icon' }),
                h('div', { key: 'title', className: 'cxi-empty-title' }, t('referencesTab')),
                h('div', { key: 'body', className: 'cxi-empty-body' }, t('referenceLibraryEmpty')),
              ])
            : h('div', { key: 'grid', className: 'cxi-ref-grid' }, referenceLibrary.map((item) => {
                const selected = references.some((reference) => reference.path === item.id);
                return h('div', { key: item.id, className: `cxi-ref-card${selected ? ' is-selected' : ''}` }, [
                  h('button', {
                    key: 'pick',
                    type: 'button',
                    className: 'cxi-ref-pick',
                    'aria-pressed': selected ? 'true' : 'false',
                    title: item.name,
                    onClick: () => toggleReference(item),
                  }, [
                    h('img', { key: 'img', src: fileUrl(item.id, sessionId), alt: item.name, loading: 'lazy', decoding: 'async' }),
                    h('span', { key: 'name', className: 'cxi-ref-card-name' }, item.name),
                    selected ? h('span', { key: 'badge', className: 'cxi-ref-badge' }, t('selected')) : null,
                  ]),
                  h('button', {
                    key: 'delete',
                    type: 'button',
                    className: 'cxi-ref-delete',
                    title: t('deleteReference'),
                    'aria-label': t('deleteReference'),
                    onClick: () => void deleteLibraryReference(item),
                  }, '×'),
                ]);
              })),
      ]);

      const windowNode = ReactDOM.createPortal(
        h(
          'section',
          {
            className: 'cxi-window',
            role: 'dialog',
            'aria-label': windowTitle,
            'aria-modal': 'false',
            'data-codex-images': 'window',
            'data-dragging': dragging ? 'true' : 'false',
            style: {
              left: `${geometry.left}px`,
              top: `${geometry.top}px`,
              width: `${geometry.width}px`,
              height: `${geometry.height}px`,
            },
            onKeyDown: (event) => {
              if (event.key !== 'Escape') return;
              if (selectedId !== '') {
                event.stopPropagation();
                setSelectedId('');
              } else if (selectedIds.length > 0) {
                event.stopPropagation();
                clearSelection();
              } else if (accountOpen) {
                event.stopPropagation();
                setAccountOpen(false);
              } else {
                event.stopPropagation();
                setOpen(false);
              }
            },
          },
          [
            h('input', {
              key: 'ref-file',
              ref: referenceInputRef,
              type: 'file',
              accept: 'image/png,image/jpeg,image/webp,image/gif',
              multiple: true,
              style: { display: 'none' },
              onChange: (event) => {
                const files = event.target.files !== null ? Array.from(event.target.files) : [];
                void addReferences(files);
              },
            }),
            h(
              'div',
              {
                key: 'head',
                className: 'cxi-head',
                title: t('drag'),
                onPointerDown: beginDrag,
              },
              [
                h('span', { key: 'icon', className: 'cxi-title', 'aria-hidden': 'true' }, [h(PictureIcon, { key: 'glyph' }), h('span', { key: 'text' }, windowTitle)]),
                h('span', { key: 'count', className: 'cxi-count', 'aria-label': String(images.length) }, String(images.length)),
                h('span', { key: 'grow', className: 'cxi-grow' }),
                h(
                  'button',
                  {
                    key: 'account',
                    type: 'button',
                    className: 'cxi-ghost',
                    'aria-pressed': accountOpen ? 'true' : 'false',
                    title: t('account'),
                    'aria-label': t('account'),
                    onClick: () => {
                      setAccountOpen(true);
                      setProxyOpen(false);
                      setCdnOpen(false);
                      setSelectedId('');
                      setRenaming(false);
                      setConfirmDelete(false);
                      void loadAccount({});
                      void loadCdn();
                    },
                  },
                  h(AccountIcon),
                ),
                h(
                  'button',
                  {
                    key: 'gen-toggle',
                    type: 'button',
                    className: 'cxi-ghost',
                    'aria-pressed': generateOpen ? 'true' : 'false',
                    title: t('generateTitle'),
                    disabled: !canGenerate,
                    onClick: () => {
                      setGenerateOpen((current) => !current);
                      setError('');
                    },
                  },
                  `✦ ${t('generate')}`,
                ),
                h(
                  'button',
                  {
                    key: 'refresh',
                    type: 'button',
                    className: 'cxi-ghost',
                    title: t('refresh'),
                    'aria-label': t('refresh'),
                    disabled: loading || busy,
                    onClick: () => void load({}),
                  },
                  '↻',
                ),
                h(
                  'button',
                  {
                    key: 'close',
                    type: 'button',
                    className: 'cxi-ghost',
                    title: t('close'),
                    'aria-label': t('close'),
                    onClick: () => {
                      setOpen(false);
                      setAccountOpen(false);
                    },
                  },
                  '✕',
                ),
              ],
            ),
            tabs,
            tab === 'gallery' ? generatePanel : null,
            tab === 'gallery' ? body : referenceBody,
            error !== ''
              ? h('div', { key: 'error', className: 'cxi-error', role: 'alert' }, error)
              : null,
            h('div', { key: 'foot', className: 'cxi-foot' }, [
              h(
                'span',
                {
                  key: 'text',
                  className: `cxi-foot-text ${error !== '' ? 'cxi-bad' : notice !== '' ? 'cxi-good' : ''}`,
                  title: footText,
                  role: error !== '' ? 'alert' : undefined,
                },
                footText,
              ),
            ]),
            dragRect === null
              ? null
              : h('div', {
                  key: 'marquee',
                  className: 'cxi-marquee',
                  style: {
                    left: `${dragRect.left}px`,
                    top: `${dragRect.top}px`,
                    width: `${dragRect.width}px`,
                    height: `${dragRect.height}px`,
                  },
                }),
            detail,
            accountPanel,
          ],
        ),
        document.body,
      );

      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            type: 'button',
            className: 'cxi-toggle',
            title: t('toggle'),
            'aria-label': t('toggle'),
            'aria-pressed': 'true',
            ref: toggleRef,
            onClick: toggleWindow,
          },
          h(PictureIcon),
        ),
        windowNode,
      );
    }

    return {
      inject: ['slots', 'locale'],

      /**
       * Register dictionaries, styles, and the composer entry.
       * @param ctx - Client root Context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'codex-images: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/codex-images/panel.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/codex-images';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'codex-images: styles');

        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'codex-images-toggle',
              order: 45,
              locale: NS,
            },
            CodexImages,
          ),
        );
      },
    };
  },
});