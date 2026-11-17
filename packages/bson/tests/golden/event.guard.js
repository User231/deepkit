// externals: ValidationErrorItem_0, stringifyValueWithType_0, isNaN_0, Date_0, Uint8Array_0
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=false;
if(v2.errors&&!("object"===typeof v0&&null!==v0)){
    v2.errors.push(new ValidationErrorItem_0("","type","Not an object",v0));
}
if("object"===typeof v0&&null!==v0){
    var v4=true;
    var v5=(v2.errors?v2.errors.length:0);
    if(v2.errors&&!("number"===typeof v0.id&&!(isNaN_0(v0.id)))){
        if(v5===v2.errors.length){
            if(v0.id===undefined){
                v2.errors.push(new ValidationErrorItem_0("id","type","Not a number",v0.id));
            }else{
                v2.errors.push(new ValidationErrorItem_0("id","type",("Cannot convert "+stringifyValueWithType_0(v0.id)+" to "+"number"),v0.id));
            }
        }
    }
    if(!("number"===typeof v0.id&&!(isNaN_0(v0.id)))){
        v4=false;
    }
    var v6=(v2.errors?v2.errors.length:0);
    if(v2.errors&&!((v0.at instanceof Date_0))){
        if(v6===v2.errors.length){
            v2.errors.push(new ValidationErrorItem_0("at","type","Not a Date",v0.at));
        }
    }
    if(!((v0.at instanceof Date_0))){
        v4=false;
    }
    var v7=(v2.errors?v2.errors.length:0);
    if(v2.errors&&!("bigint"===typeof v0.big)){
        if(v7===v2.errors.length){
            v2.errors.push(new ValidationErrorItem_0("big","type","Not a bigint",v0.big));
        }
    }
    if(!("bigint"===typeof v0.big)){
        v4=false;
    }
    var v8=(v2.errors?v2.errors.length:0);
    if(v2.errors&&!((v0.bytes instanceof Uint8Array_0))){
        if(v8===v2.errors.length){
            if(v0.bytes===undefined){
                v2.errors.push(new ValidationErrorItem_0("bytes","type","Not a Uint8Array",v0.bytes));
            }else{
                v2.errors.push(new ValidationErrorItem_0("bytes","type",("Cannot convert "+stringifyValueWithType_0(v0.bytes)+" to "+"Uint8Array"),v0.bytes));
            }
        }
    }
    if(!((v0.bytes instanceof Uint8Array_0))){
        v4=false;
    }
    var v9=(v2.errors?v2.errors.length:0);
    if(v2.errors&&!("string"===typeof v0.title)){
        if(v9===v2.errors.length){
            v2.errors.push(new ValidationErrorItem_0("title","type","Not a string",v0.title));
        }
    }
    if(!("string"===typeof v0.title)){
        v4=false;
    }
    if(null!=v0.until){
        var v10=(v2.errors?v2.errors.length:0);
        if(v2.errors&&!((v0.until instanceof Date_0))){
            if(v10===v2.errors.length){
                v2.errors.push(new ValidationErrorItem_0("until","type","Not a Date",v0.until));
            }
        }
        if(!((v0.until instanceof Date_0))){
            v4=false;
        }
    }
    v3=v4;
}
return v3;
}
