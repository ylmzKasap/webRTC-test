import './style.css'
import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, doc, addDoc, getDoc } from "firebase/firestore";
import setAuthID from './functions/set_auth_id';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const authID = setAuthID();
const connections = [];
let sendChannel;
let receiveChannel;

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);

// HTML elements
const roomID = document.getElementById('room-id');
const createRoomButton = document.getElementById('create-room-button');
const roomIdInput = document.getElementById('room-id-input');
const joinButton = document.getElementById('join-button');
const sendButton = document.getElementById('send-button');
const messageInput = document.getElementById('message-input');
const error = document.getElementById('error');

// 2. Create a room
createRoomButton.onclick = async () => {
  // Reference Firestore collections for signaling
  const roomsCollection = collection(firestore, 'rooms');
  const newRoom = await addDoc(roomsCollection, {});
  const roomDoc = doc(roomsCollection, newRoom.id);

  roomID.innerText = `Room ID: ${roomDoc.id}`;

  const requests = collection(roomDoc, 'requests');

  // Listen for remote offer
  onSnapshot(requests, async (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (!change.doc) return;

      const data = change.doc.data();
      if (!data.offer || !data.playerID) return;

      const players = collection(roomDoc, 'players');
      const playerDoc = doc(players, data.playerID);

      const responses = collection(playerDoc, 'responses');
      const answerCandidates = collection(playerDoc, 'answerCandidates');
      const offerCandidates = collection(playerDoc, 'offerCandidates');

      let hostConnection = new RTCPeerConnection(servers);
      hostConnection.onicecandidate = (event) => {
        if (event.candidate)  {
          addDoc(answerCandidates, event.candidate.toJSON());
        };
      };

      const hostChannel = hostConnection.createDataChannel('sendDataChannel');
      console.log('Created send data channel');
      hostChannel.onopen = () => console.log('Opened host send channel');

      hostConnection.ondatachannel = receiveChannelCallback;
      connections.push({
        playerID: data.playerID,
        peerConnection: hostConnection,
        sendChannel: hostChannel
      })

      const offerDescription = new RTCSessionDescription(data.offer);
      hostConnection.setRemoteDescription(offerDescription);
      console.log(`Offer from remote connection ${offerDescription.sdp}`);

      const answerDescription = await hostConnection.createAnswer();
      await hostConnection.setLocalDescription(answerDescription);

      const answer = {
        type: answerDescription.type,
        sdp: answerDescription.sdp,
      };

      // Listen remote ice candidates
      onSnapshot(offerCandidates, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            if (data.candidate) {
              const candidate = new RTCIceCandidate(data);
              hostConnection.addIceCandidate(candidate);
              console.log(`Added ice candidate as host: ${candidate}`);
            }
          }
        });
      });

    console.log('update answer' + roomDoc.id);
    await addDoc(responses, { answer }  );
    })
  });

  /* createRoomButton.disabled = true; */
  joinButton.disabled = true;
  sendButton.disabled = false;
};


// 3. Send join request with the unique ID
joinButton.onclick = async () => {
  const localConnection = new RTCPeerConnection(servers);

  const roomID = roomIdInput.value;
  const roomDoc = doc(collection(firestore, 'rooms'), roomID);

  const room = (await getDoc(roomDoc));
  if (!room.data()) {
    return error.innerText = 'No such room'
  } else {
    error.innerText = ''
  }

  sendChannel = localConnection.createDataChannel('sendDataChannel');
  localConnection.ondatachannel = receiveChannelCallback;

  const requests = collection(roomDoc, 'requests');
  const player = doc(roomDoc, 'players', authID);
  const responsesDoc = collection(player, 'responses');
  const answerCandidates = collection(player, 'answerCandidates');
  const offerCandidates = collection(player, 'offerCandidates');

  localConnection.onicecandidate = (event) => {
    console.log('new offer candidate');
    if (event.candidate) {
      console.log(`Candidate for host ${event.candidate}`, roomDoc.id);;
      addDoc(offerCandidates, event.candidate.toJSON());
    }
  };

   // Create offer
   const offerDescription = await localConnection.createOffer();
   await localConnection.setLocalDescription(offerDescription);
   console.log(`Offer from local connection: ${offerDescription.sdp}`);
 
   const offer = {
     sdp: offerDescription.sdp,
     type: offerDescription.type,
   };
 
   await addDoc(requests, {offer: offer, playerID: authID});

  // Listen for remote answer
  onSnapshot(responsesDoc, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (!change.doc) return;

      const data = change.doc.data();
      if (!data.answer) return;
      console.log('remote answer data', data);

      if (!localConnection.currentRemoteDescription && data?.answer) {
        const answerDescription = new RTCSessionDescription(data.answer);
        localConnection.setRemoteDescription(answerDescription);
        console.log(`Answer from remote connection ${answerDescription.sdp}`);
      }
    })
  });

  // Listen remote ice candidates
  onSnapshot(answerCandidates, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const data = change.doc.data();
        if (data.candidate) {
          const candidate = new RTCIceCandidate(data);
          localConnection.addIceCandidate(candidate);
          console.log(`Added ice candidate as player: ${candidate}`);
        }
      }
    });
  });

  sendButton.disabled = false;
  createRoomButton.disabled = true;
  joinButton.disabled = true;
};

sendButton.onclick = async () => {
  if (sendChannel) {
    sendChannel.send(messageInput.value);
  } else {
    connections.forEach(p => p.sendChannel.send(messageInput.value))
  }
}

function receiveChannelCallback(event) {
  console.log('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.onmessage = (e) => messageInput.value = e.data;
  receiveChannel.onopen = () => console.log('-- Opened remote connection');
  receiveChannel.onclose = () => console.log('-- Closed remote connection');
}

