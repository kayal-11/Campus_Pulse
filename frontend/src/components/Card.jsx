function Card({ title, value, detail, children, footer, accent }) {
  const accentClass = accent && ['low', 'medium', 'high'].includes(String(accent).toLowerCase())
    ? `pill pill--${String(accent).toLowerCase()}`
    : 'pill';

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="card-title">{title}</p>
          {value ? <h3>{value}</h3> : null}
          {detail ? <p className="card-detail">{detail}</p> : null}
        </div>
        {accent ? <span className={accentClass}>{accent}</span> : null}
      </div>
      {children ? <div className="card-body">{children}</div> : null}
      {footer ? <div className="card-footer">{footer}</div> : null}
    </section>
  );
}

export default Card;
