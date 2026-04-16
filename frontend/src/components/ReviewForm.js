import { useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';

function ReviewForm({ songId }) {
  const [comment, setComment] = useState('');
  const [rating, setRating] = useState(1);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    await axios.post(
      `${API_URL}/reviews/${songId}`,
      { comment, rating },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    setComment('');
    setRating(1);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2">
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="border border-black p-2 w-full"
        placeholder="Write a review..."
      />
      <select value={rating} onChange={(e) => setRating(e.target.value)} className="border border-black p-2">
        {[...Array(10)].map((_, i) => (
          <option key={i + 1} value={i + 1}>{i + 1}</option>
        ))}
      </select>
      <button type="submit" className="bg-black text-white px-4 py-2">Submit</button>
    </form>
  );
}

export default ReviewForm;
