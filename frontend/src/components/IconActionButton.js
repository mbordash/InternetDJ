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
                className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#73cbf0]/35 bg-[#008dcb]/15 text-primary-brand-50 shadow-[0_8px_24px_rgba(0,141,203,0.18)] backdrop-blur-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:ring-offset-2 focus:ring-offset-zinc-900 hover:border-[#73cbf0]/55 hover:bg-[#008dcb]/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
            >
                <Icon className={iconClassName} />
            </button>
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-primary-brand-300/30 bg-zinc-950/85 px-2.5 py-1 text-xs font-medium text-primary-brand-100 opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                {label}
            </span>
        </div>
    );
};

export default IconActionButton;

