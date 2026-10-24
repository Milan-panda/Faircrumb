import { useState } from 'react';
import { Download, MoreHorizontal, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { Modal } from './components';
import type { InstallController } from './lib/install';

export function InstallButton({ controller, compact=false }: { controller: InstallController; compact?: boolean }) {
  const [instructions, setInstructions] = useState(false);
  if (controller.installed) return null;
  return <>
    <button type="button" className={`button ${compact?'install-header':'primary'}`} disabled={controller.pending}
      onClick={async()=>{if(await controller.request()==='manual')setInstructions(true);}}>
      <Download size={compact?15:17}/>{controller.pending?'Opening…':compact?'Install':'Install app'}
    </button>
    {instructions&&<Modal title="Keep faircrumb close." close={()=>setInstructions(false)}>
      <div className="install-instructions">
        <div className="install-preview"><img src="/icon-192.png" width="56" height="56" alt=""/><div><strong>faircrumb</strong><span>Your shared expenses, on your home screen.</span></div></div>
        {controller.ios?<ol><li><Share size={18}/><span>Open this page in <strong>Safari</strong>. Tap <strong>Share</strong>, or More then Share if the toolbar is collapsed.</span></li><li><PlusSquare size={18}/><span>Choose <strong>Add to Home Screen</strong>. If it is missing, use Edit Actions in the share sheet.</span></li><li><Smartphone size={18}/><span>Keep <strong>Open as Web App</strong> enabled if offered, then tap <strong>Add</strong>.</span></li></ol>:<ol><li><MoreHorizontal size={18}/><span>Open your browser’s menu on this page.</span></li><li><Download size={18}/><span>Choose <strong>Install app</strong>, <strong>Install faircrumb</strong>, or <strong>Add to Home screen</strong>, depending on your browser.</span></li><li><Smartphone size={18}/><span>Confirm installation, then open faircrumb from its new icon.</span></li></ol>}
        <p className="helper">If this page opened inside another app, open it in your regular browser first. Installation is available on HTTPS sites and localhost; a plain HTTP address on your local network may only support a shortcut.</p>
        <p className="helper">For an existing account, add your email and password in Settings before switching browsers or devices so you can sign back in if the app uses separate browser storage.</p>
        {controller.message&&<p className="helper" role="status">{controller.message}</p>}
        <button type="button" className="button full" onClick={()=>setInstructions(false)}>Got it</button>
      </div>
    </Modal>}
  </>;
}
export function InstallPromotion({ controller }: { controller: InstallController }) {
  const [dismissed,setDismissed]=useState(()=>{try{return sessionStorage.getItem('splitfree-install-dismissed')==='true';}catch{return false;}});
  if(controller.installed||dismissed||(!controller.mobile&&!controller.available))return null;
  return <section className="install-promotion" aria-label="Install faircrumb">
    <span className="install-promotion-icon" aria-hidden="true"><Smartphone size={22}/></span>
    <div className="install-promotion-copy"><strong>Your people. One tap away.</strong><span>Add faircrumb to your home screen.</span></div>
    <InstallButton controller={controller}/>
    <button type="button" className="icon-button install-dismiss" aria-label="Dismiss install suggestion" onClick={()=>{setDismissed(true);try{sessionStorage.setItem('splitfree-install-dismissed','true');}catch{/* Dismiss for this view if storage is blocked. */}}}><X size={16}/></button>
    {controller.message&&<p className="install-feedback" role="status">{controller.message}</p>}
  </section>;
}
