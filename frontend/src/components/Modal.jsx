import { IconClose } from './Icons';

export default function Modal({ title, onClose, children, wide }) {
    return (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className={`modal ${wide ? 'wide' : ''}`}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">
                        <IconClose />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
