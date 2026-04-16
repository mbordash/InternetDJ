import { useEffect, useState } from 'react';
import axios from 'axios';
import AudioPlayer from './AudioPlayer';
import ReviewForm from './ReviewForm';
import API_URL from '../utils/api';

function ProfilePage({ userId }) {
  const [profile, setProfile] = useState(null);
  const [songs, setSongs] = useState([]);

  useEffect(() => {
    axios.get(`${API_URL}/profile/${userId}`).then(res => {
      setProfile(res.data.profile);
      setSongs(res.data.songs);
    });
  }, [userId]);

  if (!profile) return <div>Loading...</div>;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold">{profile.name}</h1>
      <p>Genre: {profile.genre}</p>
      {profile.picture_url && <img src={profile.picture_url} alt="Profile" className="w-32 h-32 mb-4" />}
      <h2 className="text-2xl mt-4">Songs</h2>
      {songs.map(song => (
        <div key={song.id} className="mb-4">
          <h3>{song.title}</h3>
          <AudioPlayer songId={song.id} s3Url={song.s3_url} />
          <ReviewForm songId={song.id} />
        </div>
      ))}
    </div>
  );
}

export default ProfilePage;
