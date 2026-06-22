import React from 'react';

const IconActionButton = ({
    icon: Icon,
    label,
    onClick,
    className = '',
    iconClassName = 'w-5 h-5',
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
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white shadow-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
            >
                <Icon className={iconClassName} />
            </button>
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-zinc-950/95 px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                {label}
            </span>
        </div>
    );
};

export default IconActionButton;

