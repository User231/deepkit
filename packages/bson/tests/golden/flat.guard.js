// externals: ValidationErrorItem_0, stringifyValueWithType_0, isNaN_0, validateUnionWithErrorsRuntime_0, const_0, const_1, const_2
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
    if(v2.errors&&!("string"===typeof v0.name)){
        if(v6===v2.errors.length){
            v2.errors.push(new ValidationErrorItem_0("name","type","Not a string",v0.name));
        }
    }
    if(!("string"===typeof v0.name)){
        v4=false;
    }
    var v7=(v2.errors?v2.errors.length:0);
    if(v2.errors&&!("boolean"===typeof v0.active)){
        if(v7===v2.errors.length){
            v2.errors.push(new ValidationErrorItem_0("active","type","Not a boolean",v0.active));
        }
    }
    if(!("boolean"===typeof v0.active)){
        v4=false;
    }
    if(null!=v0.note){
        var v8=(v2.errors?v2.errors.length:0);
        if(v2.errors&&!("string"===typeof v0.note)){
            if(v8===v2.errors.length){
                v2.errors.push(new ValidationErrorItem_0("note","type","Not a string",v0.note));
            }
        }
        if(!("string"===typeof v0.note)){
            v4=false;
        }
    }
    if(!(validateUnionWithErrorsRuntime_0(v0.score,const_0,const_1,const_2,v2.errors,"score","number | null"))){
        v4=false;
    }
    v3=v4;
}
return v3;
}

// externals: ValidationErrorItem_0, stringifyValueWithType_0, isNaN_0
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=(v2.errors?v2.errors.length:0);
if(v2.errors&&!("number"===typeof v0&&!(isNaN_0(v0)))){
    if(v3===v2.errors.length){
        if(v0===undefined){
            v2.errors.push(new ValidationErrorItem_0("","type","Not a number",v0));
        }else{
            v2.errors.push(new ValidationErrorItem_0("","type",("Cannot convert "+stringifyValueWithType_0(v0)+" to "+"number"),v0));
        }
    }
}
return "number"===typeof v0&&!(isNaN_0(v0));
}

// externals: ValidationErrorItem_0, stringifyValueWithType_0
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=(v2.errors?v2.errors.length:0);
if(v2.errors&&null!==v0){
    if(v3===v2.errors.length){
        if(v0===undefined){
            v2.errors.push(new ValidationErrorItem_0("","type","Not a null",v0));
        }else{
            v2.errors.push(new ValidationErrorItem_0("","type",("Cannot convert "+stringifyValueWithType_0(v0)+" to "+"null"),v0));
        }
    }
}
return null===v0;
}
