import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore, collection, addDoc, deleteDoc, updateDoc, doc,
  onSnapshot, query, where, orderBy, serverTimestamp, setDoc,
} from "firebase/firestore";

// ── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────────────────────
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};
// ─────────────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const gProvider = new GoogleAuthProvider();

const HOUSEHOLD_ID = "household_shared";
const CATEGORIES = ["🥦 Produce","🥩 Meat","🥛 Dairy","🍞 Bakery","🥫 Pantry","🧹 Cleaning","🛁 Personal","❄️ Frozen","🍫 Snacks","📦 Other"];
const PALETTE = ["#E8845A","#5A8FE8","#C45AC7","#4DBF8A","#F5C518","#A07DE8","#E85A7A","#5AC7C7"];
const NOTE_COLORS = ["#FFFBEB","#EBF5FF","#F5EBFF","#EBFFF3","#FFF0EB","#EBFFFC"];

function colorFor(uid) {
  if (!uid) return "#aaa";
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(name) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}
function dmId(uid1, uid2) { return [uid1, uid2].sort().join("__"); }
function timeLabel(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff/60) + "m";
  if (diff < 86400) return d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  return d.toLocaleDateString([], { month:"short", day:"numeric" });
}

export default function FamilyKart() {
  const [user, setUser] = useState(undefined);
  const [mainTab, setMainTab] = useState(0);
  const swipeStartX = useRef(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      if (u) {
        await setDoc(doc(db, "users", u.uid), {
          uid: u.uid,
          displayName: u.displayName || u.email,
          photoURL: u.photoURL || null,
          householdId: HOUSEHOLD_ID,
          lastSeen: serverTimestamp(),
        }, { merge: true });
      }
      setUser(u ?? null);
    });
  }, []);

  const onTouchStart = e => { swipeStartX.current = e.touches[0].clientX; };
  const onTouchEnd = e => {
    if (swipeStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    if (Math.abs(dx) > 55) setMainTab(t => Math.max(0, Math.min(2, dx < 0 ? t+1 : t-1)));
    swipeStartX.current = null;
  };

  if (user === undefined) return <Splash loading />;
  if (!user) return <Splash onSignIn={() => signInWithPopup(auth, gProvider)} />;

  const TABS = [{ icon:"🛒", label:"Groceries" }, { icon:"📝", label:"Notes" }, { icon:"💬", label:"Chat" }];

  return (
    <div style={S.root} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header style={S.header}>
        <div style={S.brand}><span style={S.brandIcon}>🏠</span><span style={S.brandText}>FamilyKart</span></div>
        <div style={S.headerRight}>
          <UserAvatar user={user} size={32} />
          <button style={S.signOutBtn} onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>

      <div style={S.mainTabBar}>
        {TABS.map((t, i) => (
          <button key={i} style={{ ...S.mainTab, ...(mainTab===i ? S.mainTabOn : {}) }} onClick={() => setMainTab(i)}>
            <span>{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
        <div style={{ ...S.tabPill, transform:`translateX(${mainTab*100}%)`, width:"calc(33.33% - 5px)" }} />
      </div>
      <div style={S.swipeHint}>← swipe to switch →</div>

      <div style={{ ...S.panels, transform:`translateX(${-mainTab*33.333}%)` }}>
        <div style={S.panel}><GroceriesPanel user={user} /></div>
        <div style={S.panel}><NotesPanel user={user} /></div>
        <div style={S.panel}><ChatPanel user={user} /></div>
      </div>
    </div>
  );
}

function GroceriesPanel({ user }) {
  const [scope, setScope] = useState("household");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [qty, setQty] = useState("1");
  const [category, setCategory] = useState(CATEGORIES[9]);
  const [doneTab, setDoneTab] = useState(false);
  const [filterCat, setFilterCat] = useState("All");
  const inputRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    const col = collection(db, "shopping_items");
    const q = scope==="household"
      ? query(col, where("scope","==","household"), where("householdId","==",HOUSEHOLD_ID), orderBy("createdAt","desc"))
      : query(col, where("scope","==","private"), where("ownerId","==",user.uid), orderBy("createdAt","desc"));
    return onSnapshot(q, snap => { setItems(snap.docs.map(d=>({id:d.id,...d.data()}))); setLoading(false); });
  }, [scope, user.uid]);

  async function addItem(e) {
    e.preventDefault();
    if (!input.trim()) return;
    const base = { name:input.trim(), qty:qty||"1", category, done:false, createdAt:serverTimestamp(), addedBy:user.displayName||user.email, addedByUid:user.uid };
    await addDoc(collection(db,"shopping_items"), scope==="household" ? {...base,scope:"household",householdId:HOUSEHOLD_ID} : {...base,scope:"private",ownerId:user.uid});
    setInput(""); setQty("1");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const active=items.filter(i=>!i.done), done=items.filter(i=>i.done);
  const base=doneTab?done:active;
  const displayed=filterCat==="All"?base:base.filter(i=>i.category===filterCat);
  const usedCats=["All",...CATEGORIES.filter(c=>items.some(i=>i.category===c))];

  return (
    <div style={S.panelInner}>
      <ScopeToggle scope={scope} setScope={setScope} labelA="🏠 Household" labelB="🔒 Private" colorA="#E8845A" colorB="#5A8FE8" />
      <div style={S.statsRow}>
        <StatBox num={active.length} label="To get" onClick={()=>setDoneTab(false)} />
        <div style={S.statSep}/>
        <StatBox num={done.length} label="Done ✓" color="#4DBF8A" onClick={()=>setDoneTab(true)} />
        {scope==="household"&&<><div style={S.statSep}/><StatBox num={new Set(active.map(i=>i.addedByUid)).size} label="Members"/></>}
      </div>
      <form onSubmit={addItem} style={S.form}>
        <div style={S.formRow}>
          <input ref={inputRef} style={S.input} placeholder="Add item…" value={input} onChange={e=>setInput(e.target.value)}/>
          <input style={S.qtyInput} placeholder="Qty" value={qty} onChange={e=>setQty(e.target.value)}/>
        </div>
        <div style={S.formRow}>
          <select style={S.select} value={category} onChange={e=>setCategory(e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
          <button type="submit" style={{...S.addBtn,background:scope==="private"?"#5A8FE8":"#E8845A"}}>+ Add</button>
        </div>
      </form>
      <div style={S.subTabs}>
        <button style={{...S.subTab,...(doneTab?{}:S.subTabOn)}} onClick={()=>setDoneTab(false)}>List</button>
        <button style={{...S.subTab,...(doneTab?S.subTabOn:{})}} onClick={()=>setDoneTab(true)}>Done ({done.length})</button>
      </div>
      <div style={S.chips}>{usedCats.map(c=><button key={c} style={{...S.chip,...(filterCat===c?S.chipOn:{})}} onClick={()=>setFilterCat(c)}>{c}</button>)}</div>
      {loading&&<Empty text="Loading…"/>}
      {!loading&&displayed.length===0&&<Empty text={doneTab?"No completed items.":"Nothing here — add something!"}/>}
      <div style={{padding:"4px 14px 0"}}>
        {displayed.map(item=>(
          <div key={item.id} style={{...S.item,opacity:item.done?.55:1}}>
            <button style={{...S.check,borderColor:item.done?"#4DBF8A":"#ccc",background:item.done?"#4DBF8A":"transparent"}}
              onClick={()=>updateDoc(doc(db,"shopping_items",item.id),{done:!item.done})}>
              {item.done&&<span style={{color:"#fff",fontSize:11,fontWeight:900}}>✓</span>}
            </button>
            <div style={S.itemBody}>
              <span style={{...S.itemName,textDecoration:item.done?"line-through":"none"}}>{item.name}</span>
              <div style={S.itemMeta}>
                <span style={S.metaCat}>{item.category}</span>
                <span style={S.metaQty}>× {item.qty}</span>
                {scope==="household"&&<span style={{...S.metaWho,color:colorFor(item.addedByUid)}}>{item.addedBy?.split(" ")[0]}</span>}
                {scope==="private"&&<span style={S.privateTag}>🔒</span>}
              </div>
            </div>
            <button style={S.delBtn} onClick={()=>deleteDoc(doc(db,"shopping_items",item.id))}>✕</button>
          </div>
        ))}
      </div>
      {doneTab&&done.length>0&&<button style={S.clearBtn} onClick={()=>done.forEach(i=>deleteDoc(doc(db,"shopping_items",i.id)))}>🗑 Clear done items</button>}
    </div>
  );
}

function NotesPanel({ user }) {
  const [scope,setScope]=useState("household");
  const [notes,setNotes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [composing,setComposing]=useState(false);
  const [editing,setEditing]=useState(null);
  const [title,setTitle]=useState("");
  const [body,setBody]=useState("");
  const [noteColor,setNoteColor]=useState(NOTE_COLORS[0]);

  useEffect(()=>{
    setLoading(true);
    const col=collection(db,"family_notes");
    const q=scope==="household"
      ?query(col,where("scope","==","household"),where("householdId","==",HOUSEHOLD_ID),orderBy("updatedAt","desc"))
      :query(col,where("scope","==","private"),where("ownerId","==",user.uid),orderBy("updatedAt","desc"));
    return onSnapshot(q,snap=>{setNotes(snap.docs.map(d=>({id:d.id,...d.data()})));setLoading(false);});
  },[scope,user.uid]);

  function openNew(){setEditing(null);setTitle("");setBody("");setNoteColor(NOTE_COLORS[0]);setComposing(true);}
  function openEdit(n){setEditing(n.id);setTitle(n.title||"");setBody(n.body||"");setNoteColor(n.color||NOTE_COLORS[0]);setComposing(true);}
  function close(){setComposing(false);setEditing(null);}

  async function save(){
    if(!title.trim()&&!body.trim()){close();return;}
    const base={title:title.trim(),body:body.trim(),color:noteColor,updatedAt:serverTimestamp(),authorName:user.displayName||user.email,authorUid:user.uid};
    if(editing){await updateDoc(doc(db,"family_notes",editing),base);}
    else await addDoc(collection(db,"family_notes"),scope==="household"?{...base,scope:"household",householdId:HOUSEHOLD_ID,createdAt:serverTimestamp()}:{...base,scope:"private",ownerId:user.uid,createdAt:serverTimestamp()});
    close();
  }

  return (
    <div style={S.panelInner}>
      <ScopeToggle scope={scope} setScope={setScope} labelA="🏠 Family Notes" labelB="🔒 Private" colorA="#C45AC7" colorB="#5A8FE8"/>
      {composing&&(
        <div style={S.modalOverlay}>
          <div style={{...S.modalCard,background:noteColor}}>
            <div style={S.modalHeader}>
              <span style={S.modalHeading}>{editing?"Edit note":"New note"}</span>
              <div style={S.colorRow}>{NOTE_COLORS.map(c=><button key={c} onClick={()=>setNoteColor(c)} style={{...S.colorDot,background:c,outline:c===noteColor?"3px solid #444":"2px solid #ddd"}}/>)}</div>
            </div>
            <input style={{...S.noteTitleInput,background:"transparent"}} placeholder="Title…" value={title} onChange={e=>setTitle(e.target.value)}/>
            <textarea style={{...S.noteBodyInput,background:"transparent"}} placeholder="Write your note…" value={body} onChange={e=>setBody(e.target.value)} rows={7}/>
            <div style={S.modalFooter}>
              <button style={S.cancelBtn} onClick={close}>Cancel</button>
              <button style={{...S.saveBtn,background:scope==="private"?"#5A8FE8":"#C45AC7"}} onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
      <button style={{...S.fab,background:scope==="private"?"#5A8FE8":"#C45AC7"}} onClick={openNew}>+ New Note</button>
      {loading&&<Empty text="Loading…"/>}
      {!loading&&notes.length===0&&<Empty text={scope==="private"?"🔒 No private notes yet.":"No family notes yet!"}/>}
      <div style={S.notesGrid}>
        {notes.map(n=>(
          <div key={n.id} style={{...S.noteCard,background:n.color||NOTE_COLORS[0]}} onClick={()=>openEdit(n)}>
            <div style={S.noteCardHeader}>
              {n.title&&<span style={S.noteCardTitle}>{n.title}</span>}
              <button style={S.noteDelBtn} onClick={e=>{e.stopPropagation();deleteDoc(doc(db,"family_notes",n.id));}}>✕</button>
            </div>
            {n.body&&<p style={S.noteCardBody}>{n.body.length>110?n.body.slice(0,110)+"…":n.body}</p>}
            <div style={S.noteCardFooter}>
              <span style={{fontSize:11,fontWeight:800,color:colorFor(n.authorUid)}}>{n.authorName?.split(" ")[0]}</span>
              {n.scope==="private"&&<span style={S.privateTag}>🔒</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatPanel({ user }) {
  const [view,setView]=useState("list");
  const [activeRoom,setActiveRoom]=useState(null);
  const [members,setMembers]=useState([]);
  const [lastMsgs,setLastMsgs]=useState({});

  useEffect(()=>{
    const q=query(collection(db,"users"),where("householdId","==",HOUSEHOLD_ID));
    return onSnapshot(q,snap=>setMembers(snap.docs.map(d=>d.data()).filter(m=>m.uid!==user.uid)));
  },[user.uid]);

  // Listen to last message for group chat preview
  useEffect(()=>{
    const roomId="group__"+HOUSEHOLD_ID;
    const q=query(collection(db,"chat_messages"),where("roomId","==",roomId),orderBy("createdAt","desc"));
    return onSnapshot(q,snap=>{
      if(!snap.empty) setLastMsgs(prev=>({...prev,[roomId]:snap.docs[0].data()}));
    });
  },[]);

  function openRoom(room){ setActiveRoom(room); setView("room"); }

  if(view==="room"&&activeRoom) return <ChatRoom user={user} room={activeRoom} onBack={()=>setView("list")}/>;

  return (
    <div style={S.panelInner}>
      <div style={S.chatSection}>
        <div style={S.chatSectionLabel}>Group</div>
        <div style={{...S.chatRow,borderLeft:"4px solid #E8845A"}} onClick={()=>openRoom({id:"group__"+HOUSEHOLD_ID,name:"Family Chat",type:"group"})}>
          <div style={{...S.chatAvatarBox,background:"linear-gradient(135deg,#E8845A,#F5C518)",fontSize:18}}>🏠</div>
          <div style={S.chatRowBody}>
            <span style={S.chatRowName}>Family Chat</span>
            <span style={S.chatRowSub}>
              {lastMsgs["group__"+HOUSEHOLD_ID]
                ? `${lastMsgs["group__"+HOUSEHOLD_ID].senderName?.split(" ")[0]}: ${lastMsgs["group__"+HOUSEHOLD_ID].text?.slice(0,30)}`
                : "Everyone in the household"}
            </span>
          </div>
          <span style={S.chatArrow}>›</span>
        </div>
      </div>

      <div style={S.chatSection}>
        <div style={S.chatSectionLabel}>Direct Messages</div>
        {members.length===0&&<Empty text="No other members yet. They'll appear after signing in."/>}
        {members.map(m=>(
          <div key={m.uid} style={{...S.chatRow,borderLeft:`4px solid ${colorFor(m.uid)}`}} onClick={()=>openRoom({id:dmId(user.uid,m.uid),name:m.displayName?.split(" ")[0]||"Member",type:"dm",otherUser:m})}>
            <UserAvatar user={m} size={42}/>
            <div style={S.chatRowBody}>
              <span style={{...S.chatRowName,color:colorFor(m.uid)}}>{m.displayName?.split(" ")[0]}</span>
              <span style={S.chatRowSub}>{m.displayName}</span>
            </div>
            <span style={S.chatArrow}>›</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatRoom({ user, room, onBack }) {
  const [messages,setMessages]=useState([]);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(true);
  const bottomRef=useRef(null);
  const inputRef=useRef(null);

  useEffect(()=>{
    const q=query(collection(db,"chat_messages"),where("roomId","==",room.id),orderBy("createdAt","asc"));
    return onSnapshot(q,snap=>{setMessages(snap.docs.map(d=>({id:d.id,...d.data()})));setLoading(false);});
  },[room.id]);

  useEffect(()=>{ setTimeout(()=>bottomRef.current?.scrollIntoView({behavior:"smooth"}),80); },[messages]);

  async function send(e){
    e.preventDefault();
    if(!input.trim()) return;
    await addDoc(collection(db,"chat_messages"),{
      roomId:room.id, text:input.trim(), senderId:user.uid,
      senderName:user.displayName||user.email, senderPhoto:user.photoURL||null, createdAt:serverTimestamp(),
    });
    setInput("");
    setTimeout(()=>inputRef.current?.focus(),30);
  }

  function groupMessages(msgs){
    const g=[];
    msgs.forEach((m,i)=>{
      const prev=msgs[i-1];
      if(prev&&prev.senderId===m.senderId) g[g.length-1].msgs.push(m);
      else g.push({senderId:m.senderId,senderName:m.senderName,senderPhoto:m.senderPhoto,msgs:[m]});
    });
    return g;
  }

  const grouped=groupMessages(messages);
  const accent=room.type==="group"?"#E8845A":colorFor(room.otherUser?.uid);

  return (
    <div style={S.roomRoot}>
      <div style={{...S.roomHeader,borderBottom:`3px solid ${accent}`}}>
        <button style={S.backBtn} onClick={onBack}>‹ Back</button>
        <div style={S.roomTitleRow}>
          {room.type==="group"
            ?<div style={{...S.roomAvatarBox,background:`linear-gradient(135deg,${accent},#F5C518)`}}>🏠</div>
            :<UserAvatar user={room.otherUser} size={34}/>
          }
          <div>
            <div style={S.roomName}>{room.name}</div>
            <div style={S.roomSub}>{room.type==="group"?"Family group":"Private chat"}</div>
          </div>
        </div>
        <div style={{width:64}}/>
      </div>

      <div style={S.messageList}>
        {loading&&<Empty text="Loading…"/>}
        {!loading&&messages.length===0&&(
          <div style={{textAlign:"center",padding:"48px 20px"}}>
            <div style={{fontSize:48,marginBottom:10}}>{room.type==="group"?"🏠":"💬"}</div>
            <div style={{color:"#bbb",fontSize:14,fontWeight:600,lineHeight:1.6}}>
              {room.type==="group"?"Say hello to the family!":"Start chatting with "+room.name}
            </div>
          </div>
        )}
        {grouped.map((grp,gi)=>{
          const mine=grp.senderId===user.uid;
          return (
            <div key={gi} style={{...S.msgGroup,alignItems:mine?"flex-end":"flex-start"}}>
              {!mine&&(
                <div style={S.msgSenderRow}>
                  <UserAvatar user={{uid:grp.senderId,displayName:grp.senderName,photoURL:grp.senderPhoto}} size={20}/>
                  <span style={{...S.msgSenderName,color:colorFor(grp.senderId)}}>{grp.senderName?.split(" ")[0]}</span>
                </div>
              )}
              {grp.msgs.map((m,mi)=>{
                const first=mi===0, last=mi===grp.msgs.length-1;
                return (
                  <div key={m.id} style={{...S.bubble,
                    background:mine?accent:"#EEEBE6",
                    color:mine?"#fff":"#1a1a2e",
                    borderRadius:mine
                      ?(first&&last?"18px 18px 4px 18px":last?"18px 4px 4px 18px":first?"18px 18px 4px 18px":"18px 4px 4px 18px")
                      :(first&&last?"18px 18px 18px 4px":last?"4px 18px 18px 4px":first?"18px 18px 18px 4px":"4px 18px 18px 4px"),
                    alignSelf:mine?"flex-end":"flex-start",
                  }}>
                    <span style={S.bubbleText}>{m.text}</span>
                    {last&&<span style={{...S.bubbleTime,color:mine?"rgba(255,255,255,.6)":"#bbb"}}>{timeLabel(m.createdAt)}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>

      <form style={S.chatInputBar} onSubmit={send}>
        <input ref={inputRef} style={S.chatInput} placeholder={`Message ${room.name}…`} value={input} onChange={e=>setInput(e.target.value)}/>
        <button type="submit" style={{...S.sendBtn,background:accent,opacity:input.trim()?1:.45}}>➤</button>
      </form>
    </div>
  );
}

// ── SHARED ────────────────────────────────────────────────────────────────────
function UserAvatar({ user, size=32 }) {
  const s={width:size,height:size,borderRadius:"50%",flexShrink:0,background:colorFor(user?.uid),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:900,fontSize:size*0.38};
  if(user?.photoURL) return <img src={user.photoURL} alt="" style={{...s,objectFit:"cover"}}/>;
  return <div style={s}>{initials(user?.displayName||user?.email)}</div>;
}
function ScopeToggle({ scope,setScope,labelA,labelB,colorA,colorB }) {
  return (
    <div style={S.scopeToggle}>
      <button style={{...S.scopeBtn,...(scope==="household"?{background:"#fff",color:colorA,boxShadow:"0 2px 8px rgba(0,0,0,0.09)"}:{})}} onClick={()=>setScope("household")}>{labelA}</button>
      <button style={{...S.scopeBtn,...(scope==="private"?{background:"#fff",color:colorB,boxShadow:"0 2px 8px rgba(0,0,0,0.09)"}:{})}} onClick={()=>setScope("private")}>{labelB}</button>
    </div>
  );
}
function StatBox({ num,label,color="#1a1a2e",onClick }) {
  return <div style={{flex:1,textAlign:"center",cursor:onClick?"pointer":"default",padding:"4px 0"}} onClick={onClick}><div style={{fontSize:22,fontWeight:900,color}}>{num}</div><div style={{fontSize:11,color:"#bbb",fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{label}</div></div>;
}
function Empty({ text }) { return <div style={S.empty}>{text}</div>; }

function Splash({ loading, onSignIn }) {
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(145deg,#FAF7F2,#FFF0E0)",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center",padding:32}}>
        <div style={{fontSize:72}}>🏠</div>
        <h1 style={{fontFamily:"Nunito,sans-serif",fontSize:40,fontWeight:900,color:"#1a1a2e",margin:"8px 0",letterSpacing:-1}}>FamilyKart</h1>
        <p style={{fontFamily:"Nunito,sans-serif",color:"#aaa",marginBottom:36}}>{loading?"Loading…":"Lists, notes & chat — together."}</p>
        {!loading&&<button onClick={onSignIn} style={{display:"inline-flex",alignItems:"center",gap:10,padding:"14px 28px",borderRadius:14,border:"2px solid #E0DAD2",background:"#fff",fontFamily:"Nunito,sans-serif",fontSize:16,fontWeight:800,cursor:"pointer",boxShadow:"0 4px 20px rgba(0,0,0,0.08)",color:"#1a1a2e"}}><GoogleIcon/> Sign in with Google</button>}
      </div>
    </div>
  );
}
function GoogleIcon() {
  return <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.5 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.8 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.5 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.5 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-8H6.1C9.4 36.2 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2C41.7 35.8 44 30.3 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>;
}

const S = {
  root:{fontFamily:"'Nunito',sans-serif",maxWidth:480,margin:"0 auto",minHeight:"100vh",background:"#FAF7F2",overflowX:"hidden"},
  header:{padding:"13px 18px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#FAF7F2",borderBottom:"1px solid #EDE8DF",position:"sticky",top:0,zIndex:20},
  brand:{display:"flex",alignItems:"center",gap:8},
  brandIcon:{fontSize:22},
  brandText:{fontSize:20,fontWeight:900,color:"#1a1a2e",letterSpacing:-0.5},
  headerRight:{display:"flex",alignItems:"center",gap:10},
  signOutBtn:{background:"none",border:"1.5px solid #ddd",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700,cursor:"pointer",color:"#999",fontFamily:"inherit"},
  mainTabBar:{display:"flex",margin:"10px 14px 0",background:"#EDEBE6",borderRadius:14,padding:4,position:"relative",overflow:"hidden"},
  mainTab:{flex:1,padding:"9px 0",border:"none",background:"transparent",fontFamily:"inherit",fontSize:13,fontWeight:800,color:"#aaa",cursor:"pointer",position:"relative",zIndex:2,transition:"color .2s",display:"flex",alignItems:"center",justifyContent:"center",gap:5},
  mainTabOn:{color:"#1a1a2e"},
  tabPill:{position:"absolute",top:4,left:4,height:"calc(100% - 8px)",background:"#fff",borderRadius:11,boxShadow:"0 2px 8px rgba(0,0,0,0.10)",transition:"transform .25s cubic-bezier(.4,0,.2,1)",zIndex:1,pointerEvents:"none"},
  swipeHint:{textAlign:"center",fontSize:11,color:"#ccc",fontWeight:600,padding:"4px 0 0"},
  panels:{display:"flex",width:"300%",transition:"transform .3s cubic-bezier(.4,0,.2,1)",willChange:"transform",alignItems:"flex-start"},
  panel:{width:"33.333%",overflowY:"auto"},
  panelInner:{padding:"0 0 80px"},
  scopeToggle:{display:"flex",margin:"12px 14px 0",background:"#EDEBE6",borderRadius:12,padding:3,gap:3},
  scopeBtn:{flex:1,padding:"8px 0",borderRadius:10,border:"none",background:"transparent",fontFamily:"inherit",fontSize:13,fontWeight:800,color:"#aaa",cursor:"pointer",transition:"all .15s"},
  statsRow:{display:"flex",background:"#fff",margin:"10px 14px 0",borderRadius:14,boxShadow:"0 2px 10px rgba(0,0,0,0.05)",padding:"12px 0"},
  statSep:{width:1,background:"#EDE8DF"},
  form:{padding:"10px 14px 0",display:"flex",flexDirection:"column",gap:7},
  formRow:{display:"flex",gap:7},
  input:{flex:1,padding:"10px 13px",borderRadius:11,border:"2px solid #EDE8DF",fontSize:14,fontFamily:"inherit",background:"#fff",outline:"none"},
  qtyInput:{width:56,padding:"10px 8px",borderRadius:11,border:"2px solid #EDE8DF",fontSize:14,fontFamily:"inherit",background:"#fff",outline:"none",textAlign:"center"},
  select:{flex:1,padding:"10px 13px",borderRadius:11,border:"2px solid #EDE8DF",fontSize:13,fontFamily:"inherit",background:"#fff",outline:"none",cursor:"pointer"},
  addBtn:{padding:"10px 18px",borderRadius:11,border:"none",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"},
  subTabs:{display:"flex",margin:"10px 14px 0",gap:4},
  subTab:{flex:1,padding:"8px 0",borderRadius:11,border:"none",background:"transparent",fontFamily:"inherit",fontSize:13,fontWeight:700,color:"#bbb",cursor:"pointer"},
  subTabOn:{background:"#fff",color:"#1a1a2e",boxShadow:"0 2px 8px rgba(0,0,0,0.08)"},
  chips:{display:"flex",gap:5,padding:"8px 14px",overflowX:"auto",scrollbarWidth:"none"},
  chip:{whiteSpace:"nowrap",padding:"4px 11px",borderRadius:20,border:"1.5px solid #ddd",background:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",color:"#666"},
  chipOn:{background:"#1a1a2e",color:"#fff",borderColor:"#1a1a2e"},
  empty:{textAlign:"center",color:"#ccc",padding:"36px 20px",fontSize:14},
  item:{background:"#fff",borderRadius:13,padding:"12px 13px",marginBottom:8,display:"flex",alignItems:"center",gap:10,boxShadow:"0 1px 6px rgba(0,0,0,0.05)",transition:"opacity .2s"},
  check:{width:26,height:26,borderRadius:8,border:"2.5px solid",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"background .15s"},
  itemBody:{flex:1,minWidth:0},
  itemName:{fontSize:15,fontWeight:700,color:"#1a1a2e",display:"block"},
  itemMeta:{display:"flex",gap:7,alignItems:"center",marginTop:3,flexWrap:"wrap"},
  metaCat:{fontSize:11,color:"#ccc",fontWeight:600},
  metaQty:{fontSize:11,background:"#F3F0EB",borderRadius:6,padding:"1px 7px",fontWeight:700,color:"#666"},
  metaWho:{fontSize:12,fontWeight:800},
  privateTag:{fontSize:11,color:"#5A8FE8",fontWeight:700},
  delBtn:{background:"none",border:"none",color:"#ddd",fontSize:15,cursor:"pointer",padding:"0 2px",fontFamily:"inherit"},
  clearBtn:{display:"block",margin:"14px auto 0",background:"#fff",border:"2px solid #FFD5D5",color:"#E05A5A",borderRadius:11,padding:"9px 20px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13},
  fab:{display:"block",margin:"14px 14px 0",width:"calc(100% - 28px)",padding:"12px 0",borderRadius:13,border:"none",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"inherit"},
  notesGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,padding:"10px 14px 0"},
  noteCard:{borderRadius:14,padding:"13px 13px 10px",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,0.07)",minHeight:100},
  noteCardHeader:{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:4,marginBottom:4},
  noteCardTitle:{fontSize:14,fontWeight:900,color:"#1a1a2e",lineHeight:1.3,wordBreak:"break-word"},
  noteDelBtn:{background:"none",border:"none",color:"#bbb",fontSize:13,cursor:"pointer",padding:0,flexShrink:0},
  noteCardBody:{fontSize:12,color:"#555",margin:0,lineHeight:1.6,wordBreak:"break-word"},
  noteCardFooter:{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:8},
  modalOverlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"},
  modalCard:{width:"100%",maxWidth:480,borderRadius:"22px 22px 0 0",padding:"22px 18px 36px",boxShadow:"0 -8px 40px rgba(0,0,0,0.15)"},
  modalHeader:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14},
  modalHeading:{fontSize:16,fontWeight:900,color:"#1a1a2e"},
  colorRow:{display:"flex",gap:7},
  colorDot:{width:20,height:20,borderRadius:"50%",border:"none",cursor:"pointer",outlineOffset:2},
  noteTitleInput:{display:"block",width:"100%",fontSize:18,fontWeight:900,color:"#1a1a2e",border:"none",outline:"none",fontFamily:"inherit",marginBottom:10,padding:0,boxSizing:"border-box"},
  noteBodyInput:{display:"block",width:"100%",fontSize:14,color:"#333",border:"none",outline:"none",fontFamily:"inherit",resize:"none",lineHeight:1.7,padding:0,boxSizing:"border-box"},
  modalFooter:{display:"flex",gap:10,marginTop:16,justifyContent:"flex-end"},
  cancelBtn:{padding:"9px 18px",borderRadius:10,border:"1.5px solid #ddd",background:"transparent",fontFamily:"inherit",fontSize:14,fontWeight:700,cursor:"pointer",color:"#888"},
  saveBtn:{padding:"9px 22px",borderRadius:10,border:"none",color:"#fff",fontFamily:"inherit",fontSize:14,fontWeight:800,cursor:"pointer"},
  chatSection:{padding:"12px 14px 0"},
  chatSectionLabel:{fontSize:11,color:"#bbb",fontWeight:800,textTransform:"uppercase",letterSpacing:1,marginBottom:8},
  chatRow:{display:"flex",alignItems:"center",gap:12,background:"#fff",borderRadius:14,padding:"13px 14px",marginBottom:8,cursor:"pointer",boxShadow:"0 1px 6px rgba(0,0,0,0.05)"},
  chatAvatarBox:{width:42,height:42,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},
  chatRowBody:{flex:1,minWidth:0},
  chatRowName:{display:"block",fontSize:15,fontWeight:800,color:"#1a1a2e"},
  chatRowSub:{display:"block",fontSize:12,color:"#bbb",fontWeight:600,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
  chatArrow:{fontSize:22,color:"#ddd"},
  roomRoot:{display:"flex",flexDirection:"column",height:"calc(100vh - 104px)"},
  roomHeader:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 16px",background:"#FAF7F2",flexShrink:0},
  backBtn:{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#888",fontFamily:"inherit",fontWeight:700,padding:"0 8px 0 0",width:60},
  roomTitleRow:{display:"flex",alignItems:"center",gap:10},
  roomAvatarBox:{width:34,height:34,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0},
  roomName:{fontSize:15,fontWeight:900,color:"#1a1a2e"},
  roomSub:{fontSize:11,color:"#bbb",fontWeight:600},
  messageList:{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:2},
  msgGroup:{display:"flex",flexDirection:"column",gap:3,marginBottom:8},
  msgSenderRow:{display:"flex",alignItems:"center",gap:6,marginBottom:2},
  msgSenderName:{fontSize:12,fontWeight:800},
  bubble:{maxWidth:"76%",padding:"9px 13px",display:"flex",flexDirection:"column",gap:2},
  bubbleText:{fontSize:14,lineHeight:1.5,wordBreak:"break-word"},
  bubbleTime:{fontSize:10,fontWeight:600,alignSelf:"flex-end",marginTop:1},
  chatInputBar:{display:"flex",gap:8,padding:"10px 14px 18px",background:"#FAF7F2",borderTop:"1px solid #EDE8DF",flexShrink:0},
  chatInput:{flex:1,padding:"11px 14px",borderRadius:22,border:"2px solid #EDE8DF",fontSize:14,fontFamily:"inherit",background:"#fff",outline:"none"},
  sendBtn:{width:44,height:44,borderRadius:"50%",border:"none",color:"#fff",fontSize:17,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"opacity .15s",flexShrink:0},
};
