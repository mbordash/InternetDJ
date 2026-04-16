import { useState } from 'react';
import { StarIcon } from '@heroicons/react/24/solid';

function StarRating({ rating, setRating }) {
    const [hoverRating, setHoverRating] = useState(0);

    return (
        <div className="flex space-x-1">
            {[1, 2, 3, 4, 5].map((star) => (
                <StarIcon
                    key={star}
                    className={`w-8 h-8 cursor-pointer transition-colors duration-200 ${
                        (hoverRating || rating) >= star ? 'text-yellow-400' : 'text-gray-300'
                    }`}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                />
            ))}
        </div>
    );
}

export default StarRating;