import React from 'react';

const IconActionButton = ({
    icon: Icon,
    label,
    onClick,
    className = '',
    iconClassName = 'w-[18px] h-[18px]',
    disabled = false,
    type = 'button',
}) => {
    return (
        <div className="relative group">
            <button
                type={type}
                onClick={onClick}
                disabled={disabled}
                aria-label={label}
                title={label}
                className={`retro-action h-9 w-9 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 ${className}`}
            >
                <Icon className={iconClassName} />
            </button>
            <span className="retro-tooltip pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap px-2 py-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                {label}
            </span>
        </div>
    );
};

export default IconActionButton;
