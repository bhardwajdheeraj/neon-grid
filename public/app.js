const socket=io();const $=id=>document.getElementById(id);let mySymbol=null,roomId=null,latest=null;
const cells=Array.from({length:9},(_,i)=>{const b=document.createElement('button');b.className='cell';b.setAttribute('aria-label',`Square ${i+1}`);b.addEventListener('click',()=>socket.emit('move',i));$('board').append(b);return b;});
function nickname(){return $('name').value.trim()||'Player';}
$('create').onclick=()=>socket.emit('create-room',nickname());
$('join').onclick=()=>socket.emit('join-room',{room:$('roomInput').value,name:nickname()});
$('rematch').onclick=()=>socket.emit('rematch');
$('copy').onclick=async()=>{const url=new URL(location.href);url.searchParams.set('room',roomId);try{await navigator.clipboard.writeText(url.toString());$('copy').textContent='Copied!';setTimeout(()=>$('copy').textContent='Copy invite link',1800);}catch(e){$('error').textContent='Copy unavailable. Share room code '+roomId;}};
socket.on('joined',({room,symbol})=>{roomId=room;mySymbol=symbol;$('roomCode').textContent=room;$('lobby').classList.add('hidden');$('game').classList.remove('hidden');$('error').textContent='';});
socket.on('state',s=>{latest=s;$('playerX').textContent='X — '+(s.players.find(p=>p.symbol==='X')?.name||'Waiting');$('playerO').textContent='O — '+(s.players.find(p=>p.symbol==='O')?.name||'Waiting');$('playerX').classList.toggle('active',s.turn==='X'&&!s.winner);$('playerO').classList.toggle('active',s.turn==='O'&&!s.winner);
  $('status').textContent=s.players.length<2?'Waiting for a second player...':s.winner==='draw'?"It's a draw!":s.winner?(s.winner===mySymbol?'You won! 🎉':'Your opponent won!'):s.turn===mySymbol?'Your turn!':'Opponent’s turn...';
  $('rematch').classList.toggle('hidden',!s.winner);
  cells.forEach((b,i)=>{b.textContent=s.board[i]||'';b.className='cell '+(s.board[i]||'').toLowerCase();b.disabled=!!s.winner||s.players.length<2||s.turn!==mySymbol||!!s.board[i];});
});
socket.on('game-error',message=>$('error').textContent=message);
socket.on('opponent-left',()=>{$('status').textContent='Other player disconnected. Refresh to start a new room.';cells.forEach(c=>c.disabled=true);$('rematch').classList.add('hidden');});
const invite=new URLSearchParams(location.search).get('room');if(invite)$('roomInput').value=invite.toUpperCase().slice(0,6);
