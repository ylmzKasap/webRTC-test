import './style.css'
import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, doc, addDoc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import generateRandomString from './functions/generate_random_string';

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
let authID = localStorage.getItem('authID');
if (!authID) {
  authID = generateRandomString(64);
  localStorage.setItem('privateID', authID)
}

let localConnection = new RTCPeerConnection(servers);
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
const messageInput = document.getElementById('message-input')


// 2. Create a room
createRoomButton.onclick = async () => {
  sendChannel = localConnection.createDataChannel('sendDataChannel');
  console.log('Created send data channel');
  sendChannel.onopen = () => console.log('Opened send channel');
  localConnection.ondatachannel = receiveChannelCallback;

  // Reference Firestore collections for signaling
  const roomsCollection = collection(firestore, 'rooms');
  const newRoom = await addDoc(roomsCollection, {});
  const roomDoc = doc(roomsCollection, newRoom.id);
  console.log('Save room', roomDoc.id);

  roomID.innerText = `Room ID: ${roomDoc.id}`;

  const offerCandidates = collection(roomDoc, 'offerCandidates');
  const answerCandidates = collection(roomDoc, 'answerCandidates');

  // Get candidates for answered, save to db
  localConnection.onicecandidate = (event) => {
    if (event.candidate)  {
      addDoc(answerCandidates, event.candidate.toJSON());
    };
  };

  // When offered, add candidate to peer connection
  onSnapshot(offerCandidates, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added') {
        const data = change.doc.data();
        if (data.candidate) {
          const candidate = new RTCIceCandidate(data);
          localConnection.addIceCandidate(candidate);
          console.log(`Added ice candidate as host: ${candidate}`);
        }
      }
    });
  });

  // Listen for remote offer
  onSnapshot(roomDoc, async (snapshot) => {
    const data = snapshot.data();
    console.log('remote data', data, localConnection.currentRemoteDescription, data);
    if (!localConnection.currentRemoteDescription && data.sdp) {;
      const offerDescription = new RTCSessionDescription(data);
      localConnection.setRemoteDescription(offerDescription);
      console.log(`Offer from remote connection ${offerDescription.sdp}`);

      const answerDescription = await localConnection.createAnswer();
      await localConnection.setLocalDescription(answerDescription);

      const answer = {
        type: answerDescription.type,
        sdp: answerDescription.sdp,
      };

    console.log('update answer' + roomDoc.id);
    await updateDoc(roomDoc, { answer });
    }
  });

  /* createRoomButton.disabled = true; */
  joinButton.disabled = true;
  sendButton.disabled = false;
};


// 3. Send join request with the unique ID
joinButton.onclick = async () => {
  const roomId = roomIdInput.value;
  const roomsCollection = collection(firestore, 'rooms');
  const roomDoc = doc(roomsCollection, roomId);

  sendChannel = localConnection.createDataChannel('sendDataChannel');
  localConnection.ondatachannel = receiveChannelCallback;

  const offerCandidates = collection(roomDoc, 'offerCandidates');
  const answerCandidates = collection(roomDoc, 'answerCandidates');

  localConnection.onicecandidate = (event) => {
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
 
   await setDoc(roomDoc, offer);

  // Listen for remote answer
  onSnapshot(roomDoc, (snapshot) => {
    const data = snapshot.data();
     console.log('remote answer data', data);
    if (!localConnection.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      localConnection.setRemoteDescription(answerDescription);
      console.log(`Answer from remote connection ${answerDescription.sdp}`);
    }
  });

  // When answered, add candidate to peer connection
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
};

sendButton.onclick = async () => {
  sendChannel.send(messageInput.value)  
}

function receiveChannelCallback(event) {
  console.log('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.onmessage = (e) => messageInput.value = e.data;
  receiveChannel.onopen = () => console.log('-- Opened remote connection');
  receiveChannel.onclose = () => console.log('-- Closed remote connection');
}

